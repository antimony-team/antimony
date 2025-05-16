# syntax=docker/dockerfile:1

FROM golang:1.24 AS build
WORKDIR /app

RUN go env -w GOCACHE=/go-cache
RUN go env -w GOMODCACHE=/gomod-cache

COPY src/go.mod src/go.sum ./
RUN --mount=type=cache,target=/gomod-cache go mod download

COPY src .
RUN --mount=type=cache,target=/gomod-cache --mount=type=cache,target=/go-cache CGO_ENABLED=0 go build -v -o /antimony-server

FROM ghcr.io/srl-labs/clab:0.67.0

COPY config.default.yml /config.default.yml
COPY data /data
COPY --from=build /antimony-server .

EXPOSE 3000

ENTRYPOINT ["/antimony-server"]