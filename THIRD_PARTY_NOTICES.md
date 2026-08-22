# Third-Party Notices

## League of Legends minimap detection model

Recall includes an ONNX export of `yolo11m-minimap.pt` from
[`boboyes/leagueoflegends-minimap-detection`](https://huggingface.co/boboyes/leagueoflegends-minimap-detection),
revision `5c98bdcfa1961a3bb1be57591e7d20d6eb0ac531`. The upstream model is
licensed under Creative Commons Attribution-NonCommercial 4.0 International
(CC BY-NC 4.0). The model was developed with the
[`bsowlx/DeepestLeague`](https://github.com/bsowlx/DeepestLeague) minimap
detection toolkit.

The original checkpoint SHA-256 is
`c247901341e905fd39633ccb7a4ef3133bcb7c8f9375bfda962d13f6bfa3d755`.
The exact exported artifact and its checksum are recorded in
`resources/minimap-model/manifest.json`.

## DeepestLeague synthetic training toolkit

Recall's development-only minimap training tools and synthetic map/effect
assets are adapted from
[`bsowlx/DeepestLeague`](https://github.com/bsowlx/DeepestLeague), revision
`8cb084f6ae9a89362d30dc2200e775d91cf66f64`, copyright 2026 Baiastan. The
toolkit is licensed under the MIT License. Its complete license text is kept at
`minimap_training/UPSTREAM_LICENSE`.

## ONNX Runtime

Recall uses [Microsoft ONNX Runtime](https://github.com/microsoft/onnxruntime),
licensed under the MIT License, for local model inference.

## Riot Games assets

Recall includes champion portrait assets distributed through Riot Games Data
Dragon. Recall is not endorsed by Riot Games and does not reflect the views or
opinions of Riot Games or anyone officially involved in producing or managing
Riot Games properties. Riot Games and all associated properties are trademarks
or registered trademarks of Riot Games, Inc.
