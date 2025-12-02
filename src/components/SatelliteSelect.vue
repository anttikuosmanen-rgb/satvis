<template>
  <div class="satellite-select">
    <div class="toolbarTitle">Enabled satellite groups</div>
    <div class="toolbarContent">
      <vue-multiselect v-model="enabledTags" :options="availableTags" :multiple="true" :searchable="false" placeholder="0 satellite groups selected" />
    </div>
    <div class="toolbarTitle">Enabled satellites</div>
    <div class="toolbarContent">
      <vue-multiselect
        ref="satelliteMultiselect"
        v-model="allEnabledSatellites"
        :options="availableSatellites"
        :multiple="true"
        group-values="sats"
        group-label="tag"
        :group-select="true"
        placeholder="Type to search"
        :close-on-select="false"
        :limit="0"
        :limit-text="(count) => `${count} satellite${count > 1 ? 's' : ''} selected`"
        :options-limit="currentOptionsLimit"
        @open="onDropdownOpen"
        @close="onDropdownClose"
      >
        <template #noResult> No matching satellites </template>
        <template #afterList>
          <div v-if="hasMoreOptions" class="multiselect__loading-more">Scroll for more...</div>
        </template>
      </vue-multiselect>
    </div>
  </div>
</template>

<script>
import VueMultiselect from "vue-multiselect";
import { mapWritableState } from "pinia";

import { useSatStore } from "../stores/sat";

export default {
  components: {
    VueMultiselect,
  },
  data() {
    return {
      currentOptionsLimit: 100, // Start with 100 items
      optionsLimitIncrement: 100, // Load 100 more at a time
      scrollListener: null,
    };
  },
  computed: {
    ...mapWritableState(useSatStore, ["availableSatellitesByTag", "availableTags", "enabledSatellites", "enabledTags", "trackedSatellite"]),
    availableSatellites() {
      let satlist = Object.keys(this.availableSatellitesByTag).map((tag) => ({
        tag,
        sats: this.availableSatellitesByTag[tag],
      }));
      if (satlist.length === 0) {
        satlist = [];
      }
      return satlist;
    },
    satellitesEnabledByTag() {
      return this.getSatellitesFromTags(this.enabledTags);
    },
    totalAvailableOptions() {
      // Count total satellites across all tags
      return this.availableSatellites.reduce((sum, group) => sum + (group.sats?.length || 0), 0);
    },
    hasMoreOptions() {
      return this.currentOptionsLimit < this.totalAvailableOptions;
    },
    allEnabledSatellites: {
      get() {
        return this.satellitesEnabledByTag.concat(this.enabledSatellites ?? []);
      },
      set(sats) {
        const enabledTags = this.availableTags.filter((tag) => !this.availableSatellitesByTag[tag].some((sat) => !sats.includes(sat)));
        const satellitesInEnabledTags = this.getSatellitesFromTags(enabledTags);
        const enabledSatellites = sats.filter((sat) => !satellitesInEnabledTags.includes(sat));
        cc.sats.enabledSatellites = enabledSatellites;
        cc.sats.enabledTags = enabledTags;
      },
    },
  },
  watch: {
    enabledSatellites(sats) {
      cc.sats.enabledSatellites = sats;
    },
    enabledTags(tags) {
      cc.sats.enabledTags = tags;
    },
    trackedSatellite(satellite) {
      cc.sats.trackedSatellite = satellite;
    },
  },
  beforeUnmount() {
    // Clean up listener if component is destroyed while dropdown is open
    if (this.scrollListener) {
      this.onDropdownClose();
    }
  },
  methods: {
    getSatellitesFromTags(taglist) {
      return taglist.map((tag) => this.availableSatellitesByTag[tag] || []).flat();
    },
    onDropdownOpen() {
      // Reset to initial limit when dropdown opens
      this.currentOptionsLimit = 100;

      // Add scroll listener to the dropdown list
      this.$nextTick(() => {
        const dropdownList = this.$refs.satelliteMultiselect?.$el?.querySelector(".multiselect__content-wrapper");
        if (dropdownList) {
          this.scrollListener = this.onScroll.bind(this);
          dropdownList.addEventListener("scroll", this.scrollListener);
        }
      });
    },
    onDropdownClose() {
      // Clean up scroll listener when dropdown closes
      const dropdownList = this.$refs.satelliteMultiselect?.$el?.querySelector(".multiselect__content-wrapper");
      if (dropdownList && this.scrollListener) {
        dropdownList.removeEventListener("scroll", this.scrollListener);
        this.scrollListener = null;
      }
    },
    onScroll(event) {
      const target = event.target;
      const scrollTop = target.scrollTop;
      const scrollHeight = target.scrollHeight;
      const clientHeight = target.clientHeight;

      // Load more when scrolled to within 100px of bottom
      const threshold = 100;
      if (scrollHeight - scrollTop - clientHeight < threshold && this.hasMoreOptions) {
        this.loadMoreOptions();
      }
    },
    loadMoreOptions() {
      // Increase the limit by the increment amount
      const newLimit = this.currentOptionsLimit + this.optionsLimitIncrement;
      this.currentOptionsLimit = Math.min(newLimit, this.totalAvailableOptions);
    },
  },
};
</script>

<style scoped>
.satellite-select {
  width: 300px;
}
</style>

<style>
@import "vue-multiselect/dist/vue-multiselect.css";

.multiselect__loading-more {
  padding: 8px 12px;
  text-align: center;
  font-size: 12px;
  color: #666;
  background: #f8f8f8;
  border-top: 1px solid #e8e8e8;
}
</style>
