package daemon

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/dorman/openlegion/internal/daemon/store"
	"github.com/dorman/openlegion/internal/display"
	"github.com/dorman/openlegion/internal/engine"
	"github.com/dorman/openlegion/internal/microvm/types"
)

type Server struct {
	store   *store.Store
	engine  engine.Engine
	display *display.Bridge
	listen  string
}

func NewServer(st *store.Store, eng engine.Engine) *Server {
	return &Server{
		store:   st,
		engine:  eng,
		display: display.NewBridge(),
		listen:  env("OPENLEGION_MICROVM_LISTEN", "127.0.0.1:7420"),
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /vms", s.handleList)
	mux.HandleFunc("POST /vms", s.handleCreate)
	mux.HandleFunc("POST /vms/{id}/stop", s.handleStop)
	mux.HandleFunc("POST /vms/{id}/start", s.handleStart)
	mux.HandleFunc("DELETE /vms/{id}", s.handleDelete)
	mux.HandleFunc("GET /vms/{id}/logs", s.handleLogs)
	mux.HandleFunc("GET /vms/{id}/shell", s.handleShell)
	mux.HandleFunc("GET /vms/{id}/display", s.handleDisplay)
	mux.HandleFunc("GET /vms/{id}/display/ws", s.handleDisplayWS)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.engine.Available(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, types.HealthResponse{
		OK:       true,
		Features: []string{"logs", "shell", "display", "desktop-v2"},
	})
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	items, err := s.engine.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if items == nil {
		items = []types.VMInfo{}
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreate(w http.ResponseWriter, r *http.Request) {
	var req types.CreateVMRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}

	req.Image = strings.TrimSpace(req.Image)
	if req.Image == "" && !isDesktopKind(req.Kind) {
		writeError(w, http.StatusBadRequest, "image is required")
		return
	}

	created, err := s.engine.Create(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	kind := strings.TrimSpace(req.Kind)
	if kind == "" {
		kind = "container"
	}

	vm := s.store.Create(store.VM{
		ID:          created.ID,
		ContainerID: created.ContainerID,
		SandboxID:   created.SandboxID,
		NetworkName: created.NetworkName,
		Kind:        kind,
		Image:       req.Image,
		Name:        req.Name,
		Env:         req.Env,
		Ports:       req.Ports,
		Volumes:     req.Volumes,
		Command:     req.Command,
		MemoryMB:    req.MemoryMB,
	})

	writeJSON(w, http.StatusCreated, toVMInfo(vm))
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}

	if err := s.engine.Start(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, types.HealthResponse{OK: true})
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}

	if err := s.engine.Stop(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	s.display.Revoke(id)
	writeJSON(w, http.StatusOK, types.HealthResponse{OK: true})
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}

	if err := s.engine.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	s.display.Revoke(id)
	s.store.Delete(id)
	writeJSON(w, http.StatusOK, types.HealthResponse{OK: true})
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}

	tail := 200
	if raw := strings.TrimSpace(r.URL.Query().Get("tail")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, "tail must be a non-negative integer")
			return
		}
		tail = parsed
	}

	logs, err := s.engine.Logs(r.Context(), id, tail)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, types.LogsResponse{Logs: logs})
}

func (s *Server) handleShell(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}

	command, err := s.engine.ShellCommand(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	runtime := "docker"
	if strings.HasPrefix(id, "desktop-") {
		runtime = "qemu"
	}

	writeJSON(w, http.StatusOK, types.ShellResponse{
		Command: command,
		Runtime: runtime,
	})
}

func (s *Server) handleDisplay(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}

	info, err := s.engine.Display(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	token := s.display.Register(id, display.Session{
		TargetHost: info.TargetHost,
		TargetPort: info.TargetPort,
		Password:   info.Password,
		Kind:       info.Kind,
	})

	kind := info.Kind
	if kind == "" {
		kind = "vnc-websocket"
	}

	writeJSON(w, http.StatusOK, types.DisplayResponse{
		URL:      display.WebSocketURL(r, id, token),
		Kind:     kind,
		Password: info.Password,
	})
}

func (s *Server) handleDisplayWS(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if id == "" || token == "" {
		writeError(w, http.StatusBadRequest, "id and token are required")
		return
	}
	s.display.ServeWS(w, r, id, token)
}

func toVMInfo(vm store.VM) types.VMInfo {
	kind := strings.TrimSpace(vm.Kind)
	if kind == "" {
		kind = "container"
	}
	return types.VMInfo{
		ID:      vm.ID,
		Image:   vm.Image,
		Name:    vm.Name,
		Kind:    kind,
		Display: kind == "desktop" || hasPublishedVncPort(vm.Ports),
	}
}

func hasPublishedVncPort(ports []types.PortMapping) bool {
	for _, port := range ports {
		container := strings.TrimSpace(port.Container)
		if container == "5900" || container == "5900/tcp" {
			return true
		}
	}
	return false
}

func isDesktopKind(kind string) bool {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "desktop", "qemu", "vm":
		return true
	default:
		return false
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, types.ErrorResponse{Error: message})
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
