<template>
  <svg
    viewBox="0 0 42 42"
    role="presentation"
    aria-hidden="true"
    focusable="false"
  >
    <path
      class="mark-orbit"
      d="M7.5 30.5A16 16 0 0 1 9 9.5M33 9.5a16 16 0 0 1 1.5 21"
    />
    <path
      class="mark-letter"
      fill-rule="evenodd"
      d="M11 35V7h11.3C29.5 7 34 10.9 34 17.2c0 4.3-2.1 7.5-5.8 9.1L36 35h-8.1l-6.7-7.6h-3.5V35H11Zm6.7-21.8v8.2h4.1c3.5 0 5.4-1.4 5.4-4.1 0-2.8-1.9-4.1-5.4-4.1h-4.1Z"
    />
    <path class="mark-shine" d="M14.2 32V10.2h7.9c4.7 0 7.9 2.2 8.7 5.8" />
  </svg>
</template>

<style scoped>
.mark-orbit {
  fill: none;
  stroke: var(--cyan);
  stroke-width: 1.8;
  stroke-linecap: round;
  opacity: 0.72;
}

.mark-letter {
  fill: var(--gold);
}

.mark-shine {
  fill: none;
  stroke: var(--gold-bright);
  stroke-width: 1.1;
  stroke-linecap: round;
  opacity: 0.9;
}
</style>
