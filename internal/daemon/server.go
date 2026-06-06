package daemon

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/dorman/openlegion/internal/daemon/store"
	"github.com/dorman/openlegion/internal/engine"
	"github.com/dorman/openlegion/internal/microvm/types"
)

type Server struct {
	store  *store.Store
	engine engine.Engine
}

func NewServer(st *store.Store, eng engine.Engine) *Server {
	return &Server{
		store:  st,
		engine: eng,
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /vms", s.handleList)
	mux.HandleFunc("POST /vms", s.handleCreate)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.engine.Available(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, types.HealthResponse{OK: true})
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
	if req.Image == "" {
		writeError(w, http.StatusBadRequest, "image is required")
		return
	}

	created, err := s.engine.Create(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	vm := s.store.Create(store.VM{
		ID:          created.ID,
		ContainerID: created.ContainerID,
		SandboxID:   created.SandboxID,
		NetworkName: created.NetworkName,
		Image:       req.Image,
		Name:        req.Name,
		Env:         req.Env,
		Ports:       req.Ports,
		Volumes:     req.Volumes,
		Command:     req.Command,
	})

	writeJSON(w, http.StatusCreated, toVMInfo(vm))
}

func toVMInfo(vm store.VM) types.VMInfo {
	return types.VMInfo{
		ID:    vm.ID,
		Image: vm.Image,
		Name:  vm.Name,
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
