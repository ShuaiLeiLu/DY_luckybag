package main

import (
	"crypto/subtle"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Operational access control is independent of client licensing.
func protectAPI(next http.Handler, token string) http.Handler {
	type bucket struct {
		tokens  float64
		updated time.Time
	}
	var mu sync.Mutex
	buckets := make(map[string]bucket)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" || (r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/desktop/") && r.URL.Path != "/desktop/notice") {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodOptions && token != "" {
			supplied := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if subtle.ConstantTimeCompare([]byte(supplied), []byte(token)) != 1 {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "api_access_denied"})
				return
			}
		}
		ip, _, _ := net.SplitHostPort(r.RemoteAddr)
		now := time.Now()
		mu.Lock()
		b, ok := buckets[ip]
		if !ok {
			b = bucket{tokens: 200, updated: now}
		}
		b.tokens = min(200, b.tokens+now.Sub(b.updated).Seconds()*100)
		b.updated = now
		allowed := b.tokens >= 1
		if allowed {
			b.tokens--
		}
		buckets[ip] = b
		if len(buckets) > 5000 {
			for key, value := range buckets {
				if now.Sub(value.updated) > time.Minute {
					delete(buckets, key)
				}
			}
		}
		mu.Unlock()
		if !allowed {
			w.Header().Set("Retry-After", "1")
			writeJSON(w, http.StatusTooManyRequests, map[string]any{"ok": false, "error": "api_rate_limited"})
			return
		}
		next.ServeHTTP(w, r)
	})
}
