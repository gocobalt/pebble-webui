# pebble-webui

An embeddable web UI for browsing and inspecting [Pebble](https://github.com/cockroachdb/pebble) KV store keys. Ships as a single Go module with zero frontend build step — just import, pass your store, and mount on your Gin router.

## Features

- Key browser with search by prefix or exact key
- Cursor-based pagination for large datasets
- Auto-detect rendering: JSON tree viewer, plain text, hex dump for binary
- Quick-filter chips for key type prefixes (configurable)
- Single-key detail view with download support for large values
- Dark theme, single embedded HTML file (~13KB), no npm/node required
- Optional HTTP Basic Auth

## What It Does

This module exposes a `/pebble-ui` route group on your Gin engine that serves:

- **A web UI** — a single-page HTML app for browsing keys, viewing values, and downloading raw data
- **A JSON API** — endpoints for listing keys, fetching values, downloading raw bytes, and retrieving store stats

Your application passes its own store (anything with `Get` and `Scan` methods) and configuration. The module does not define or manage any store — it only reads from what you provide.

## Installation

```bash
go get github.com/gocobalt/pebble-webui@latest
```

## Usage

```go
import pebbleui "github.com/gocobalt/pebble-webui"

// Your store just needs Get() and Scan() — no explicit interface import needed.
ui := pebbleui.New(myStore, pebbleui.Options{
    BasePath: "/pebble-ui",
    Username: "admin",
    Password: "secret",
    KeyTypes: []pebbleui.KeyType{
        {
            Prefix:      "users/",
            Label:       "Users",
            Description: "User profile data",
            Example:     "users/{userID}",
        },
    },
})
ui.Register(router) // router is a *gin.Engine
```

Then open `http://localhost:8080/pebble-ui` in your browser.

### Store Interface

Your store must satisfy this interface (Go matches it implicitly):

```go
type Store interface {
    Get(ctx context.Context, key []byte) ([]byte, error)
    Scan(ctx context.Context, start, end []byte, fn func(key, value []byte) bool) error
}
```

### Options

| Field      | Type         | Description                                      |
|------------|--------------|--------------------------------------------------|
| `BasePath` | `string`     | URL prefix (default `"/pebble-ui"`)              |
| `Username` | `string`     | Basic Auth username (empty disables auth)         |
| `Password` | `string`     | Basic Auth password                               |
| `KeyTypes` | `[]KeyType`  | Quick-filter chips shown in the UI                |

## Cloning

```bash
git clone https://github.com/gocobalt/pebble-webui.git
cd pebble-webui
```

## Developing

The entire UI is a single `index.html` file with inline CSS and JavaScript — no build tools, no npm, no bundler.

```bash
# Get dependencies
go mod tidy

# Build
go build ./...

# Vet
go vet ./...
```

To modify the UI, edit `index.html` directly. The `{{BASE_PATH}}` placeholder is replaced at runtime with the configured base path.

To test changes in a host application without publishing, see [Local development](#local-development-skip-publish-cycle) below.

## Releasing a New Version

After making changes to this module, follow these steps to release and update the consuming service.

### 1. Commit and push your changes

```bash
git add .
git commit -m "feat: describe your change"
git push
```

### 2. Tag a semver release

```bash
git tag v0.2.0
git push --tags
```

Use [semver](https://semver.org/) — bump the patch for fixes (`v0.1.1`), minor for new features (`v0.2.0`), major for breaking changes (`v1.0.0`).

### 3. Update the consuming service

In the host repo (e.g. thanos):

```bash
go get github.com/gocobalt/pebble-webui@v0.2.0
```

This updates `go.mod` and `go.sum`. Commit those changes:

```bash
git add go.mod go.sum
git commit -m "deps: bump pebble-webui to v0.2.0"
```

### Quick update (without tagging)

If you just want the latest commit without a formal release:

```bash
go get github.com/gocobalt/pebble-webui@latest
```

This pulls the latest commit as a pseudo-version (e.g. `v0.0.0-20260415...-abc1234`). Fine for development, but tagged versions are recommended for production.

### Local development (skip publish cycle)

Add a replace directive in the host's `go.mod` to point at your local checkout:

```
replace github.com/gocobalt/pebble-webui => ../pebble-webui
```

Remove it before committing.

## License

MIT License

Copyright (c) 2026 Refold.ai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

Maintained by [Refold.ai](https://refold.ai/)
