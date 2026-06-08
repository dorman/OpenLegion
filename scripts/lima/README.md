# Lima backend for OpenLegion desktop VMs

On macOS, QEMU desktop sandboxes run inside a small Linux VM. Lima provides that layer.

## Start

```bash
limactl start --name=openlegion ./scripts/lima/openlegion.yaml
limactl shell openlegion
```

Inside the Lima shell:

```bash
cd ~/Downloads/openlegion
export OPENLEGION_QEMU_IMAGE="$HOME/.openlegion/images/desktop.qcow2"
go run ./cmd/openlegion-microvm
```

The desktop app talks to `http://127.0.0.1:7420` through Lima port forwarding.

## Desktop image

Set `OPENLEGION_QEMU_IMAGE` to a qcow2 Linux image with a desktop and VNC server.
OpenLegion copies that image per VM under `~/.openlegion/qemu-vms/`.

Suggested defaults:

| Variable | Default |
| --- | --- |
| `OPENLEGION_QEMU_IMAGE` | required for desktop workloads |
| `OPENLEGION_QEMU_MEMORY_MB` | `2048` |
| `OPENLEGION_QEMU_ROOT` | `~/.openlegion/qemu-vms` |

## RAM budget

| Layer | Planned RAM |
| --- | --- |
| Lima VM | 4 GiB |
| One desktop guest | 2–4 GiB |
| OpenLegion Desktop | ~0.5 GiB |

Plan for ~6–8 GiB host RAM with one desktop VM open.

## API

```bash
curl -X POST http://127.0.0.1:7420/vms \
  -H 'Content-Type: application/json' \
  -d '{"kind":"desktop","name":"re-lab","memoryMb":2048}'

curl http://127.0.0.1:7420/vms/desktop-*/display
```

The display endpoint returns a short-lived websocket URL for the in-app noVNC panel.
