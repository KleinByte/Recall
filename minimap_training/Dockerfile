FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    WANDB_DISABLED=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY minimap_training/requirements.txt /tmp/minimap-training-requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/minimap-training-requirements.txt

COPY minimap_training /workspace/minimap_training
COPY resources/champion-portraits /workspace/resources/champion-portraits

ENTRYPOINT ["python", "-m", "minimap_training.pipeline"]
