<script setup lang="ts">
import { publicAssetUrl } from "../helpers/assets"
</script>

<template>
  <img
    :src="publicAssetUrl('recall-icon.png')"
    role="presentation"
    aria-hidden="true"
    draggable="false"
  >
</template>

<style scoped>
img {
  display: block;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}
</style>
