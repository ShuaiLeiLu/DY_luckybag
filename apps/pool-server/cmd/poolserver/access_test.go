package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOperationalToken(t *testing.T) {
	handler := protectAPI(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }), "test-secret")
	for _, tc := range []struct {
		path, token string
		code        int
	}{{"/health", "", 204}, {"/task/claim", "", 401}, {"/task/claim", "Bearer wrong", 401}, {"/task/claim", "Bearer test-secret", 204}} {
		req := httptest.NewRequest("POST", tc.path, nil)
		req.Header.Set("Authorization", tc.token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != tc.code {
			t.Fatalf("%s: %d", tc.path, w.Code)
		}
	}
}
