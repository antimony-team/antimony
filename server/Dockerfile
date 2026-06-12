# syntax=clabernetes/dockerfile:1

FROM golang:1.26 AS build
WORKDIR /

RUN go env -w GOCACHE=/go-cache
RUN go env -w GOMODCACHE=/gomod-cache

COPY src/go.mod src/go.sum ./
RUN go mod download

COPY src .
RUN CGO_ENABLED=0 go build -v -o ./antimony-server

FROM ghcr.io/srl-labs/clab:0.76.0
WORKDIR /app

COPY data ./data
COPY --from=build /antimony-server .

EXPOSE 3000

ENTRYPOINT ["./antimony-server"]