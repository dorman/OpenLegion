package store

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"

	"github.com/dorman/openlegion/internal/microvm/types"
)

type VM struct {
	ID          string
	ContainerID string
	SandboxID   string
	NetworkName string
	Image       string
	Name        string
	Env         map[string]string
	Ports       []types.PortMapping
	Volumes     []types.VolumeMapping
	Command     []string
}

type Store struct {
	mu  sync.RWMutex
	vms map[string]*VM
}

func New() *Store {
	return &Store{
		vms: make(map[string]*VM),
	}
}

func (s *Store) Create(vm VM) VM {
	s.mu.Lock()
	defer s.mu.Unlock()

	if vm.ID == "" {
		vm.ID = newID()
	}
	if vm.SandboxID == "" {
		vm.SandboxID = vm.ID
	}

	stored := vm
	s.vms[stored.ID] = &stored
	return stored
}

func (s *Store) List() []VM {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]VM, 0, len(s.vms))
	for _, vm := range s.vms {
		out = append(out, *vm)
	}
	return out
}

func (s *Store) Get(id string) (VM, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	vm, ok := s.vms[id]
	if !ok {
		return VM{}, fmt.Errorf("vm %q not found", id)
	}
	return *vm, nil
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("generate vm id: %v", err))
	}
	return "vm-" + hex.EncodeToString(b[:])
}
