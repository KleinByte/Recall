"""Build Recall's optimized UI mark and Windows icon from its master."""

from pathlib import Path
import sys

from PIL import Image


ICON_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
PUBLIC_ICON_SIZE = 512


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(
            "usage: build-icon.py INPUT_PNG OUTPUT_PNG OUTPUT_ICO"
        )

    source_path = Path(sys.argv[1])
    public_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3])
    source = Image.open(source_path).convert("RGBA")

    if source.width != source.height:
        raise SystemExit("icon source must be square")

    alpha = source.getchannel("A")
    if alpha.getbbox() is None:
        raise SystemExit("icon source is fully transparent")

    public_path.parent.mkdir(parents=True, exist_ok=True)
    public_icon = source.resize(
        (PUBLIC_ICON_SIZE, PUBLIC_ICON_SIZE),
        Image.Resampling.LANCZOS,
    )
    public_icon.save(public_path, format="PNG", optimize=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    source.save(
        output_path,
        format="ICO",
        sizes=[(size, size) for size in ICON_SIZES],
    )


if __name__ == "__main__":
    main()
