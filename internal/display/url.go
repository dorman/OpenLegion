package display

import (
	"fmt"
	"net"
	"net/http"
	"strings"
)

func WebSocketURL(r *http.Request, vmID, token string) string {
	host := requestHost(r)
	scheme := "ws"
	if r.TLS != nil {
		scheme = "wss"
	}
	return fmt.Sprintf("%s://%s/vms/%s/display/ws?token=%s", scheme, host, vmID, token)
}

func requestHost(r *http.Request) string {
	if host := strings.TrimSpace(r.Host); host != "" {
		return host
	}
	return "127.0.0.1:7420"
}

func ListenHost(listen string) string {
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		return listen
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, port)
}
