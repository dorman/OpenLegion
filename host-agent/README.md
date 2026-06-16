# OpenLegion host agent (self-hosted Kata sandbox host)

Turns a **sacrificial Linux tower** (a spare x86_64 box running Ubuntu/Debian)
into an OpenLegion sandbox host: it runs security-research desktops as
**Kata-isolated micro-VMs** — each with its own guest kernel and a KVM hardware
boundary, plus no network egress — so a malware sample can't escape onto the host
or call home.

This is the core of OpenLegion's security-research half. (The developer half —
plain Docker / Kubernetes containers — is built elsewhere; those don't need this
VM-grade boundary.) The researcher never touches the host OS; they get a browser
URL to a contained XFCE desktop (see `../packages/sandbox-images/`).

## The pieces

| Script | Role |
|---|---|
| `preflight.sh` | Is this box capable? (x86_64, VT-x/AMD-V, `/dev/kvm`, RAM) |
| `setup-kata.sh` | Install Docker + Kata, register the `kata` runtime, create the no-egress network |
| `verify.sh` | **Acceptance gate** — proves Kata boots its own guest kernel and egress is blocked |
| `launch-session.sh` | Start one hardened, no-egress, Kata-isolated session |
| `destroy-session.sh` | Tear down sessions; `--prune <ttl>` for the ephemeral lifecycle |

## Run order (on the Linux box)

```sh
sudo ./preflight.sh        # confirm the hardware can do it
sudo ./setup-kata.sh       # install + configure the isolation runtime
sudo ./verify.sh           # PROVE it isolates — don't proceed unless this passes
./launch-session.sh        # spin up a session, prints the noVNC URL
```

## Design notes / honest caveats

- **The agent runs privileged; the sandboxes do not.** The agent needs root /
  Docker / `/dev/kvm` to build and tear down micro-VMs. The research containers
  it launches are the opposite — `--cap-drop ALL`, no `--privileged`, no host
  mounts, no egress. Run the agent on a *dedicated* tower, not a daily driver.
- **`verify.sh` is the gate.** A session must not start unless Kata boots a
  separate guest kernel *and* egress is blocked, so a misconfigured host can't
  silently fall back to a weak shared-kernel boundary.
- **Hypervisor = QEMU by default.** Kata still makes it a micro-VM. Firecracker
  saves some RAM but needs the containerd `devmapper` snapshotter — opt-in only
  (see `setup-kata.sh`).
- **Docker↔Kata wiring is version-sensitive.** If `docker run --runtime kata`
  fails after setup, the runtime/shim path may differ for your Kata release;
  `verify.sh` surfaces it.
- **Connectivity:** sessions publish noVNC to `127.0.0.1` only. LAN-local use
  works immediately; remote access needs the broker/dial-out tunnel (next phase).
- **Not infallible.** Kata is a hardware-VM boundary, not magic — hypervisor
  escapes are rare but exist. The product should gate sessions behind a
  "research use at your own risk" acknowledgement.

## Untested on macOS

These target a Linux/KVM host and cannot run on an Apple Silicon Mac (no KVM).
`verify.sh` is the real test — run it on the actual tower.
