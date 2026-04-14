package pebbleui

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const (
	defaultPageLimit  = 50
	maxPageLimit      = 200
	valuePreviewBytes = 200
	maxInlineBytes    = 1 << 20 // 1 MB
)

//go:embed static/index.html static/style.css static/app.js
var staticFS embed.FS

// Store is the minimal interface the caller's store must satisfy.
// Go's implicit interface matching means the caller never needs to
// reference this type — any store with Get and Scan just works.
type Store interface {
	Get(ctx context.Context, key []byte) ([]byte, error)
	Scan(ctx context.Context, start, end []byte, fn func(k, v []byte) bool) error
}

// KeyType defines a key prefix filter shown in the UI.
// The caller passes these to describe their key schema.
type KeyType struct {
	Prefix      string `json:"prefix"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Example     string `json:"example"`
}

// Options configures the Pebble UI handler.
// The caller passes their store and key types.
type Options struct {
	// BasePath is the URL prefix (default "/pebble-ui").
	BasePath string
	// Username for HTTP Basic Auth. Empty disables auth.
	Username string
	// Password for HTTP Basic Auth.
	Password string
	// KeyTypes shown as quick-filter chips in the UI.
	KeyTypes []KeyType
}

// Handler serves the Pebble UI and its API.
type Handler struct {
	store         Store
	opts          Options
	basePath      string
	assembledHTML string
}

// New creates a handler. The caller's store is used directly.
func New(store Store, opts Options) *Handler {
	bp := opts.BasePath
	if bp == "" {
		bp = "/pebble-ui"
	}
	bp = strings.TrimRight(bp, "/")

	return &Handler{
		store:         store,
		opts:          opts,
		basePath:      bp,
		assembledHTML: assembleHTML(),
	}
}

// Register mounts all pebble-ui routes on the gin engine.
func (h *Handler) Register(r *gin.Engine) {
	var middleware []gin.HandlerFunc
	if h.opts.Username != "" {
		middleware = append(middleware,
			gin.BasicAuth(gin.Accounts{h.opts.Username: h.opts.Password}),
		)
	}

	// API
	api := r.Group(h.basePath+"/api", middleware...)
	api.GET("/keys", h.handleListKeys)
	api.GET("/key", h.handleGetKey)
	api.GET("/key/download", h.handleDownloadKey)
	api.GET("/stats", h.handleStats)
	api.GET("/key-types", h.handleKeyTypes)

	// UI — serve index.html
	r.GET(h.basePath, append(middleware, h.serveIndex)...)
	r.GET(h.basePath+"/", append(middleware, h.serveIndex)...)
}

// --- API handlers ---

func (h *Handler) storeAvailable(c *gin.Context) bool {
	if h.store == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no store available"})
		return false
	}
	return true
}

type keyEntry struct {
	Key          string `json:"key"`
	ValueSize    int    `json:"value_size"`
	ValuePreview string `json:"value_preview"`
}

type listKeysResponse struct {
	Keys       []keyEntry `json:"keys"`
	NextCursor string     `json:"next_cursor,omitempty"`
}

func (h *Handler) handleListKeys(c *gin.Context) {
	if !h.storeAvailable(c) {
		return
	}

	prefix := c.Query("prefix")
	cursor := c.Query("cursor")
	limit := parseLimit(c.DefaultQuery("limit", "50"))

	var startKey []byte
	if cursor != "" {
		decoded, err := base64.URLEncoding.DecodeString(cursor)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
			return
		}
		startKey = append(decoded, 0)
	} else if prefix != "" {
		startKey = []byte(prefix)
	}

	var endKey []byte
	if prefix != "" {
		endKey = prefixEnd([]byte(prefix))
	}

	if startKey == nil {
		startKey = []byte{0}
	}
	if endKey == nil {
		endKey = []byte{0xff, 0xff, 0xff, 0xff}
	}

	ctx := context.Background()
	entries := make([]keyEntry, 0, limit+1)
	count := 0

	err := h.store.Scan(ctx, startKey, endKey, func(k, v []byte) bool {
		if count >= limit+1 {
			return false
		}
		count++
		entries = append(entries, keyEntry{
			Key:          string(k),
			ValueSize:    len(v),
			ValuePreview: truncatePreview(v, valuePreviewBytes),
		})
		return true
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "scan failed"})
		return
	}

	resp := listKeysResponse{Keys: entries}
	if len(entries) > limit {
		lastKey := entries[limit].Key
		resp.NextCursor = base64.URLEncoding.EncodeToString([]byte(lastKey))
		resp.Keys = entries[:limit]
	}

	c.JSON(http.StatusOK, resp)
}

type getKeyResponse struct {
	Key       string      `json:"key"`
	Value     interface{} `json:"value"`
	Size      int         `json:"size"`
	Encoding  string      `json:"encoding"`
	Truncated bool        `json:"truncated"`
}

func (h *Handler) handleGetKey(c *gin.Context) {
	if !h.storeAvailable(c) {
		return
	}

	key := c.Query("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key parameter required"})
		return
	}

	ctx := context.Background()
	val, err := h.store.Get(ctx, []byte(key))
	if err != nil || val == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "key not found"})
		return
	}

	size := len(val)
	resp := getKeyResponse{Key: key, Size: size}

	if size > maxInlineBytes {
		resp.Truncated = true
		resp.Encoding = detectEncoding(val[:10240])
		resp.Value = truncatePreview(val, 10240)
		c.JSON(http.StatusOK, resp)
		return
	}

	resp.Encoding = detectEncoding(val)

	var parsed interface{}
	if json.Valid(val) {
		if err := json.Unmarshal(val, &parsed); err == nil {
			resp.Value = parsed
			resp.Encoding = "json"
			c.JSON(http.StatusOK, resp)
			return
		}
	}

	if utf8.Valid(val) {
		resp.Value = string(val)
		c.JSON(http.StatusOK, resp)
		return
	}

	resp.Value = base64.StdEncoding.EncodeToString(val)
	resp.Encoding = "base64"
	c.JSON(http.StatusOK, resp)
}

func (h *Handler) handleDownloadKey(c *gin.Context) {
	if !h.storeAvailable(c) {
		return
	}

	key := c.Query("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key parameter required"})
		return
	}

	ctx := context.Background()
	val, err := h.store.Get(ctx, []byte(key))
	if err != nil || val == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "key not found"})
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.bin\"", key))
	c.Data(http.StatusOK, "application/octet-stream", val)
}

func (h *Handler) handleStats(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"store_available": h.store != nil})
}

func (h *Handler) handleKeyTypes(c *gin.Context) {
	kt := h.opts.KeyTypes
	if kt == nil {
		kt = []KeyType{}
	}
	c.JSON(http.StatusOK, gin.H{"key_types": kt})
}

// --- UI serving ---

// assembledHTML is built once at New() time by composing the three static files.
func assembleHTML() string {
	htmlBytes, _ := staticFS.ReadFile("static/index.html")
	cssBytes, _ := staticFS.ReadFile("static/style.css")
	jsBytes, _ := staticFS.ReadFile("static/app.js")

	page := string(htmlBytes)
	page = strings.Replace(page, "{{STYLE}}", string(cssBytes), 1)
	page = strings.Replace(page, "{{SCRIPT}}", string(jsBytes), 1)
	return page
}

func (h *Handler) serveIndex(c *gin.Context) {
	html := strings.ReplaceAll(h.assembledHTML, "{{BASE_PATH}}", h.basePath)
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// --- Helpers ---

func prefixEnd(prefix []byte) []byte {
	end := make([]byte, len(prefix))
	copy(end, prefix)
	for i := len(end) - 1; i >= 0; i-- {
		end[i]++
		if end[i] != 0 {
			return end
		}
	}
	return nil
}

func truncatePreview(data []byte, maxBytes int) string {
	if len(data) <= maxBytes {
		if utf8.Valid(data) {
			return string(data)
		}
		return base64.StdEncoding.EncodeToString(data)
	}
	snippet := data[:maxBytes]
	if utf8.Valid(snippet) {
		return string(snippet) + "..."
	}
	return base64.StdEncoding.EncodeToString(snippet) + "..."
}

func detectEncoding(data []byte) string {
	if json.Valid(data) {
		return "json"
	}
	if utf8.Valid(data) {
		return "text"
	}
	return "binary"
}

func parseLimit(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return defaultPageLimit
	}
	if n > maxPageLimit {
		return maxPageLimit
	}
	return n
}
