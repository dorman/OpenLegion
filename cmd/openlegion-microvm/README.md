# openlegion-microvm

Local sandbox daemon for OpenLegion. It wraps Docker containers in per-workload isolated networks and can launch QEMU desktop VMs.

## Run

```bash
go run ./cmd/openlegion-microvm
```

Defaults to `http://127.0.0.1:7420`. Configure with:

| Variable | Default |
| --- | --- |
| `OPENLEGION_MICROVM_LISTEN` | `127.0.0.1:7420` |
| `OPENLEGION_MICROVM_URL` | used by the TypeScript client |
| `OPENLEGION_SANDBOX_ROOT` | `~/.openlegion/sandboxes` |
| `OPENLEGION_DOCKER_RUNTIME` | `docker` |
| `OPENLEGION_QEMU_IMAGE` | required for `kind: desktop` |
| `OPENLEGION_QEMU_MEMORY_MB` | `2048` |
| `OPENLEGION_QEMU_ROOT` | `~/.openlegion/qemu-vms` |

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Daemon and runtime availability |
| `GET` | `/vms` | List sandbox workloads |
| `POST` | `/vms` | Create and start a sandbox workload |
| `POST` | `/vms/{id}/start` | Start a stopped workload (Docker container or QEMU desktop VM) |
| `POST` | `/vms/{id}/stop` | Stop a workload |
| `DELETE` | `/vms/{id}` | Remove workload and metadata |
| `GET` | `/vms/{id}/logs` | Recent logs |
| `GET` | `/vms/{id}/shell` | Shell command metadata |
| `GET` | `/vms/{id}/display` | Remote desktop websocket session |
| `GET` | `/vms/{id}/display/ws` | VNC websocket proxy |

Example container:

```bash
curl -X POST http://127.0.0.1:7420/vms \
  -H 'Content-Type: application/json' \
  -d '{"image":"alpine:latest","name":"workload","command":["sleep","3600"]}'
```

Example desktop VM:

```bash
curl -X POST http://127.0.0.1:7420/vms \
  -H 'Content-Type: application/json' \
  -d '{"kind":"desktop","name":"re-lab","memoryMb":2048}'
```

## macOS

Use the Lima template in `scripts/lima/` to run this daemon inside Linux when QEMU desktop VMs are needed.
