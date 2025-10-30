<template>
  <div v-if="show && showTimer && nextPass" class="pass-countdown-overlay">
    <div class="countdown-display" :class="{ active: isPassActive }">
      <div class="time-segment">
        <span class="digit">{{ minutes[0] }}</span>
        <span class="digit">{{ minutes[1] }}</span>
      </div>
      <div class="separator">:</div>
      <div class="time-segment">
        <span class="digit">{{ seconds[0] }}</span>
        <span class="digit">{{ seconds[1] }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  trackedSatellite: {
    type: String,
    default: null,
  },
  passes: {
    type: Array,
    default: () => [],
  },
});

const showTimer = ref(false);
const nextPass = ref(null);
const countdown = ref(0);
const isPassActive = ref(false);
let intervalId = null;

const minutes = computed(() => {
  const totalMinutes = Math.floor(Math.abs(countdown.value) / 60);
  return String(totalMinutes).padStart(2, '0').split('');
});

const seconds = computed(() => {
  const totalSeconds = Math.floor(Math.abs(countdown.value) % 60);
  return String(totalSeconds).padStart(2, '0').split('');
});

const updateCountdown = () => {
  if (!nextPass.value) return;

  const now = Date.now();
  const passStart = new Date(nextPass.value.start).getTime();
  const passEnd = new Date(nextPass.value.end).getTime();

  if (now < passStart) {
    // Before pass starts - count down to start (red)
    countdown.value = Math.floor((passStart - now) / 1000);
    isPassActive.value = false;
  } else if (now >= passStart && now <= passEnd) {
    // During pass - count down to end (green)
    countdown.value = Math.floor((passEnd - now) / 1000);
    isPassActive.value = true;
  } else {
    // Pass ended - find next pass
    findNextPass();
  }
};

const findNextPass = () => {
  if (!props.passes || props.passes.length === 0) {
    nextPass.value = null;
    showTimer.value = false;
    return;
  }

  const now = Date.now();

  // Find the next upcoming pass or current pass
  const upcomingPass = props.passes.find(pass => {
    const passEnd = new Date(pass.end).getTime();
    return passEnd > now;
  });

  if (upcomingPass) {
    nextPass.value = upcomingPass;
    showTimer.value = true;
    updateCountdown();
  } else {
    nextPass.value = null;
    showTimer.value = false;
  }
};

// Watch for tracked satellite changes
watch(() => props.trackedSatellite, (newSat) => {
  if (newSat) {
    findNextPass();
  } else {
    showTimer.value = false;
    nextPass.value = null;
  }
});

// Watch for passes changes
watch(() => props.passes, () => {
  if (props.trackedSatellite) {
    findNextPass();
  }
}, { deep: true });

onMounted(() => {
  // Update countdown every second
  intervalId = setInterval(updateCountdown, 1000);

  if (props.trackedSatellite) {
    findNextPass();
  }
});

onUnmounted(() => {
  if (intervalId) {
    clearInterval(intervalId);
  }
});
</script>

<style scoped>
.pass-countdown-overlay {
  position: fixed;
  top: 38px;
  left: 0;
  right: 0;
  height: 20vh;
  background: rgba(0, 0, 0, 0.85);
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
}

.countdown-display {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  width: 100%;
  height: 100%;
}

.time-segment {
  display: flex;
  gap: 10px;
}

.digit {
  display: inline-block;
  font-size: 12vh;
  font-weight: 300;
  font-family: 'DSEG7 Classic', 'Segment7', 'Courier New', monospace;
  color: #ff0000;
  text-shadow: 0 0 20px rgba(255, 0, 0, 0.6);
  line-height: 1;
  letter-spacing: -0.05em;
}

.countdown-display.active .digit {
  color: #00ff00;
  text-shadow: 0 0 30px rgba(0, 255, 0, 0.8);
}

.separator {
  font-size: 12vh;
  font-weight: 300;
  color: #fff;
  text-shadow: 0 0 15px rgba(255, 255, 255, 0.4);
  line-height: 1;
}

.countdown-display.active .separator {
  color: #00ff00;
  text-shadow: 0 0 20px rgba(0, 255, 0, 0.5);
}
</style>
