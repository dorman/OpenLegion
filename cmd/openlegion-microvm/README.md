# openlegion-microvm

Local sandbox daemon for OpenLegion. It wraps Docker containers in per-workload isolated networks (not the default Docker bridge).

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

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Daemon and Docker availability |
| `GET` | `/vms` | List sandbox workloads |
| `POST` | `/vms` | Create and start a sandboxed container |
| `POST` | `/vms/{id}/stop` | Stop a workload |
| `DELETE` | `/vms/{id}` | Remove workload, network, and sandbox metadata |

Example:

```bash
curl -X POST http://127.0.0.1:7420/vms \
  -H 'Content-Type: application/json' \
  -d '{"image":"alpine:latest","name":"workload","command":["sleep","3600"]}'
```

## CLI

With the daemon running (or with Docker/Podman on `PATH`):

```bash
openlegion container list
openlegion container create --image alpine:latest --command sleep 3600
openlegion container stop <id>
openlegion container rm <id>
```
