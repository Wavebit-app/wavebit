# syntax=docker/dockerfile:1
# Pin both images by digest when publishing (docker buildx imagetools inspect).
FROM golang:1.27.4-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -buildid=" -o /out/wavebit-party ./cmd/wavebit-party

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/wavebit-party /wavebit-party
# Inside the container's own network; publish it only through a proxy.
ENV JAM_LISTEN_ADDR=0.0.0.0:8000
EXPOSE 8000
USER nonroot:nonroot
ENTRYPOINT ["/wavebit-party"]
