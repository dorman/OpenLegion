# Ghidra layered onto the reusable RE desktop (see ../re-desktop). This image is
# thin: it just adds Ghidra + a menu launcher / autostart entry. The XFCE desktop,
# RE toolset, X-to-web stack, and non-root user all come from the base.

FROM openlegion/re-desktop:latest

ARG GHIDRA_VERSION=12.1.2
ARG GHIDRA_URL=https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.2_build/ghidra_12.1.2_PUBLIC_20260605.zip
# Optional integrity pin: set to the asset's sha256 to verify the download.
ARG GHIDRA_SHA256=

USER root

# Ghidra 12 requires JDK 21 (not in the base, which only ships a JRE-less desktop).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-21-jdk \
 && rm -rf /var/lib/apt/lists/* \
 && ln -sf "$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")" /opt/java
ENV JAVA_HOME=/opt/java

RUN curl -fL "$GHIDRA_URL" -o /tmp/ghidra.zip \
 && if [ -n "$GHIDRA_SHA256" ]; then echo "$GHIDRA_SHA256  /tmp/ghidra.zip" | sha256sum -c -; fi \
 && unzip -q /tmp/ghidra.zip -d /opt \
 && mv /opt/ghidra_* /opt/ghidra \
 && rm /tmp/ghidra.zip \
 && ln -s /opt/ghidra/ghidraRun /usr/local/bin/ghidraRun

# Menu entry + autostart so Ghidra appears in the XFCE applications menu and
# opens automatically when the desktop session starts.
COPY ghidra.desktop /usr/share/applications/ghidra.desktop
RUN mkdir -p /home/analyst/.config/autostart \
 && cp /usr/share/applications/ghidra.desktop /home/analyst/.config/autostart/ghidra.desktop \
 && chown -R analyst:analyst /home/analyst/.config

USER analyst
