#!/bin/bash
set -euo pipefail

usage() {
    cat <<'USAGE'
Usage: ./bin/push-kiao-image.sh --repository ghcr.io/<owner>/kiao
                                [--image kiao:latest] [--tag TAG ...]

Pushes an existing local image to GitHub Container Registry.
Authenticate first with: docker login ghcr.io -u <github-login>

  --repository NAME  Destination without a tag, in lowercase (required).
  --image NAME       Local image to publish (default: kiao:latest).
  --tag TAG          Destination tag; repeat for multiple tags (default: latest).
  -h, --help         Show this help.
USAGE
}

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

REPOSITORY=""
LOCAL_IMAGE="kiao:latest"
TAGS=()

while [ "$#" -gt 0 ]; do
    case "$1" in
        --repository|--image|--tag)
            if [ "$#" -lt 2 ] || [ -z "$2" ] || [[ "$2" == --* ]]; then
                fail "$1 requires a value. See --help."
            fi
            case "$1" in
                --repository) REPOSITORY="$2" ;;
                --image) LOCAL_IMAGE="$2" ;;
                --tag) TAGS+=("$2") ;;
            esac
            shift 2
            ;;
        -h|--help) usage; exit 0 ;;
        *) fail "Unknown argument: $1. See --help." ;;
    esac
done

if [[ ! "$REPOSITORY" =~ ^ghcr\.io/[a-z0-9][a-z0-9-]*/[a-z0-9]+([._-]+[a-z0-9]+)*$ ]]; then
    fail "--repository must be ghcr.io/<owner>/<image> in lowercase, without a tag."
fi

if [ "${#TAGS[@]}" -eq 0 ]; then
    TAGS=(latest)
fi
for tag in "${TAGS[@]}"; do
    if [[ ! "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]]; then
        fail "Invalid Docker tag: $tag"
    fi
done

command -v docker >/dev/null 2>&1 || fail "Docker is required."
if ! IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$LOCAL_IMAGE")"; then
    fail "Cannot inspect local image $LOCAL_IMAGE. Check Docker and build or load the image first."
fi

# Resolve once so all destination tags refer to the same local image.
for tag in "${TAGS[@]}"; do
    docker image tag "$IMAGE_ID" "$REPOSITORY:$tag"
done

for tag in "${TAGS[@]}"; do
    echo "Pushing $REPOSITORY:$tag"
    docker image push "$REPOSITORY:$tag"
done

echo "Published $IMAGE_ID"
echo "First publication: set the package visibility to Public in GitHub's package settings."
