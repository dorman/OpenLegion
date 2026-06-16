package display

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Session struct {
	TargetHost string
	TargetPort string
	Password   string
	// Kind selects how the target is bridged: "cdp" resolves the Chromium page
	// debugger and tunnels WebSocket<->WebSocket; anything else (default) pumps
	// raw bytes WebSocket<->TCP for VNC/RFB.
	Kind      string
	ExpiresAt time.Time
}

type Bridge struct {
	mu       sync.Mutex
	sessions map[string]Session
}

func NewBridge() *Bridge {
	return &Bridge{
		sessions: make(map[string]Session),
	}
}

func (b *Bridge) Register(vmID string, session Session) string {
	token := newToken()
	key := sessionKey(vmID, token)
	session.ExpiresAt = time.Now().Add(30 * time.Minute)

	b.mu.Lock()
	b.sessions[key] = session
	b.mu.Unlock()

	return token
}

func (b *Bridge) ServeWS(w http.ResponseWriter, r *http.Request, vmID, token string) {
	session, ok := b.lookup(vmID, token)
	if !ok {
		http.Error(w, "display session expired or invalid", http.StatusUnauthorized)
		return
	}

	if session.Kind == "cdp" {
		serveCDP(w, r, session)
		return
	}

	target, err := net.Dial("tcp", net.JoinHostPort(session.TargetHost, session.TargetPort))
	if err != nil {
		http.Error(w, "display backend unavailable", http.StatusBadGateway)
		return
	}
	defer target.Close()

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	errCh := make(chan error, 2)
	go func() {
		errCh <- copyWSToTCP(conn, target)
	}()
	go func() {
		errCh <- copyTCPToWS(target, conn)
	}()

	<-errCh
}

// serveCDP resolves the Chromium page target behind the forwarded debug port and
// tunnels the viewer's WebSocket straight to it, so the renderer speaks the
// Chrome DevTools Protocol directly (Page.startScreencast + Input.dispatch*).
func serveCDP(w http.ResponseWriter, r *http.Request, session Session) {
	pageWS, err := resolveCDPTarget(session.TargetHost, session.TargetPort)
	if err != nil {
		http.Error(w, "cdp backend unavailable: "+err.Error(), http.StatusBadGateway)
		return
	}

	// Dial Chromium's page debugger. Host is an IP literal so Chromium's
	// DNS-rebinding guard is satisfied; launch flags include --remote-allow-origins.
	upstream, _, err := websocket.DefaultDialer.Dial(pageWS, nil)
	if err != nil {
		http.Error(w, "cdp dial failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer upstream.Close()

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	errCh := make(chan error, 2)
	go func() { errCh <- pumpWS(conn, upstream) }()
	go func() { errCh <- pumpWS(upstream, conn) }()
	<-errCh
}

// resolveCDPTarget asks the Chromium debug endpoint for a page target and
// returns its WebSocket debugger URL, rewritten to the forwarded host:port
// (the /json response advertises the guest's own 127.0.0.1:9222).
func resolveCDPTarget(host, port string) (string, error) {
	base := "http://" + net.JoinHostPort(host, port)
	client := &http.Client{Timeout: 3 * time.Second}
	res, err := client.Get(base + "/json")
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	var targets []struct {
		Type                 string `json:"type"`
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := json.NewDecoder(res.Body).Decode(&targets); err != nil {
		return "", err
	}
	for _, t := range targets {
		if t.Type == "page" && t.WebSocketDebuggerURL != "" {
			u, err := url.Parse(t.WebSocketDebuggerURL)
			if err != nil {
				return "", err
			}
			u.Host = net.JoinHostPort(host, port)
			return u.String(), nil
		}
	}
	return "", fmt.Errorf("no page target on cdp endpoint")
}

// pumpWS forwards messages one way between two WebSocket connections.
func pumpWS(src, dst *websocket.Conn) error {
	for {
		mt, payload, err := src.ReadMessage()
		if err != nil {
			return err
		}
		if err := dst.WriteMessage(mt, payload); err != nil {
			return err
		}
	}
}

func (b *Bridge) lookup(vmID, token string) (Session, bool) {
	key := sessionKey(vmID, token)

	b.mu.Lock()
	defer b.mu.Unlock()

	session, ok := b.sessions[key]
	if !ok {
		return Session{}, false
	}
	if time.Now().After(session.ExpiresAt) {
		delete(b.sessions, key)
		return Session{}, false
	}
	return session, true
}

func (b *Bridge) Revoke(vmID string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	prefix := vmID + ":"
	for key := range b.sessions {
		if strings.HasPrefix(key, prefix) {
			delete(b.sessions, key)
		}
	}
}

func sessionKey(vmID, token string) string {
	return vmID + ":" + token
}

func newToken() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("generate display token: %v", err))
	}
	return hex.EncodeToString(b[:])
}

func copyWSToTCP(ws *websocket.Conn, target net.Conn) error {
	for {
		messageType, payload, err := ws.ReadMessage()
		if err != nil {
			return err
		}
		if messageType != websocket.BinaryMessage && messageType != websocket.TextMessage {
			continue
		}
		if _, err := target.Write(payload); err != nil {
			return err
		}
	}
}

func copyTCPToWS(target net.Conn, ws *websocket.Conn) error {
	buf := make([]byte, 32*1024)
	for {
		n, err := target.Read(buf)
		if n > 0 {
			if writeErr := ws.WriteMessage(websocket.BinaryMessage, buf[:n]); writeErr != nil {
				return writeErr
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}
