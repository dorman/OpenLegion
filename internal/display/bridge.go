package display

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
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
	ExpiresAt  time.Time
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
	session, ok := b.consume(vmID, token)
	if !ok {
		http.Error(w, "display session expired or invalid", http.StatusUnauthorized)
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

func (b *Bridge) consume(vmID, token string) (Session, bool) {
	key := sessionKey(vmID, token)

	b.mu.Lock()
	defer b.mu.Unlock()

	session, ok := b.sessions[key]
	if !ok {
		return Session{}, false
	}
	delete(b.sessions, key)
	if time.Now().After(session.ExpiresAt) {
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
