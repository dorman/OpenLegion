package daemon

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
}

func status(h http.Handler, method, path, authHeader string) int {
	req := httptest.NewRequest(method, path, nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func TestWithAuthDisabledWhenNoToken(t *testing.T) {
	h := (&Server{}).withAuth(okHandler())
	if code := status(h, "GET", "/vms", ""); code != http.StatusOK {
		t.Fatalf("no token configured should allow all requests, got %d", code)
	}
}

func TestWithAuthGuardsControlAPI(t *testing.T) {
	s := &Server{token: "s3cret"}
	h := s.withAuth(okHandler())

	cases := []struct {
		name, method, path, header string
		want                       int
	}{
		{"no header", "GET", "/vms", "", http.StatusUnauthorized},
		{"wrong token", "GET", "/vms", "Bearer nope", http.StatusUnauthorized},
		{"malformed scheme", "GET", "/vms", "s3cret", http.StatusUnauthorized},
		{"valid token", "GET", "/vms", "Bearer s3cret", http.StatusOK},
		{"create guarded", "POST", "/vms", "", http.StatusUnauthorized},
		{"health open", "GET", "/health", "", http.StatusOK},
		{"display ws exempt", "GET", "/vms/abc/display/ws", "", http.StatusOK},
		{"display GET guarded", "GET", "/vms/abc/display", "", http.StatusUnauthorized},
	}
	for _, tc := range cases {
		if code := status(h, tc.method, tc.path, tc.header); code != tc.want {
			t.Errorf("%s: got %d, want %d", tc.name, code, tc.want)
		}
	}
}
