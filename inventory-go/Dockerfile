# Stage 1: Build
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN go build -o inventory-service main.go

# Stage 2: Final image
FROM alpine:latest
WORKDIR /root/
COPY --from=builder /app/inventory-service .
CMD ["./inventory-service"]