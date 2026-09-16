SHELL := /bin/sh

.DEFAULT_GOAL := run

GO ?= go
NODE ?= node
TMPDIR ?= /tmp
BUILD_DIR ?= $(TMPDIR)/ls-tools
BINARY ?= $(BUILD_DIR)/ls-tools-server

.PHONY: run build test test-go test-js clean

run:
	./run.sh

build:
	mkdir -p "$(BUILD_DIR)"
	$(GO) build -o "$(BINARY)" .

test: test-go test-js

test-go:
	$(GO) test ./...

test-js:
	$(NODE) --test tests/*.test.js

clean:
	rm -f "$(BINARY)"
