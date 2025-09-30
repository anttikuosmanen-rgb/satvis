<template>
  <div class="app">
    <toast position="bottom-right" />
    <router-view />
  </div>
</template>

<script>
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./css/main.css";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import { onMounted } from "vue";
import { initToastProxy } from "./composables/useToastProxy";

export default {
  components: {
    Toast,
  },
  setup() {
    const toast = useToast();

    onMounted(() => {
      // Initialize toast utility for non-Vue contexts
      initToastProxy(toast);
    });
  },
};
</script>
