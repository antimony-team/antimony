# syntax=docker/dockerfile:1

# Alpine-based builder so the cgo parts (gopacket/afpacket) link against musl,
# matching the clab runtime image below.
FROM golang:1.26-alpine AS build
WORKDIR /

# linux-headers provides linux/if_packet.h, which afpacket's cgo code includes.
RUN apk add --no-cache build-base linux-headers

RUN go env -w GOCACHE=/go-cache
RUN go env -w GOMODCACHE=/gomod-cache

COPY src/go.mod src/go.sum ./
RUN go mod download

COPY src .
# CGO is required: gopacket/afpacket defines pageSize via C.getpagesize().
RUN CGO_ENABLED=1 go build \
    -ldflags '-linkmode external -extldflags "-static"' \
    -o ./antimony-server

FROM ghcr.io/srl-labs/clab:0.76.0
WORKDIR /app

COPY data ./data
COPY --from=build /antimony-server .

EXPOSE 3000

ENTRYPOINT ["./antimony-server"]