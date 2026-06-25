package main

import (
	"log"
	"net"
	"net/http"
	"os"

	"github.com/dorman/openlegion/internal/daemon"
	"github.com/dorman/openlegion/internal/daemon/store"
	"github.com/dorman/openlegion/internal/engine"
)

func main() {
	addr := env("OPENLEGION_MICROVM_LISTEN", "127.0.0.1:7420")

	st := store.New()
	eng := engine.NewRouter()
	srv := daemon.NewServer(st, eng)

	// Bind before logging "listening" so the log doesn't claim success when the
	// port is already in use (e.g. an orphaned daemon is still bound to it).
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("microvm daemon listening on http://%s", addr)
	log.Printf("mode: docker sandboxes + optional qemu desktop vms")
	if err := http.Serve(ln, srv.Routes()); err != nil {
		log.Fatal(err)
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
