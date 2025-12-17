<template>
  <div class="satellite-select">
    <div class="toolbarTitle">Enabled satellite groups</div>
    <div class="toolbarContent" :class="{ 'menu-item-focused': focusedIndex === 0 }">
      <vue-multiselect
        ref="groupsMultiselect"
        v-model="enabledTags"
        :options="availableTags"
        :multiple="true"
        :searchable="false"
        placeholder="0 satellite groups selected"
        @open="onGroupsDropdownOpen"
        @close="onGroupsDropdownClose"
      />
    </div>
    <div class="toolbarTitle">Enabled satellites</div>
    <div class="toolbarContent" :class="{ 'menu-item-focused': focusedIndex === 1 }">
      <vue-multiselect
        ref="satelliteMultiselect"
        v-model="allEnabledSatellites"
        :options="availableSatellites"
        :multiple="true"
        placeholder="Type to search"
        :close-on-select="false"
        :limit="0"
        :limit-text="(count) => `${count} satellite${count > 1 ? 's' : ''} selected`"
        :options-limit="currentOptionsLimit"
        @open="onDropdownOpen"
        @close="onDropdownClose"
      >
        <template #option="{ option }">
          <span class="satellite-option" title="Right-click to track" @contextmenu.prevent="onSatelliteRightClick(option)">{{ option }}</span>
        </template>
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
  props: {
    focusedIndex: {
      type: Number,
      default: -1,
    },
  },
  emits: ["dropdown-opened", "dropdown-closed", "navigate-to-groups"],
  data() {
    return {
      currentOptionsLimit: 100, // Start with 100 items
      optionsLimitIncrement: 100, // Load 100 more at a time
      scrollListener: null,
      satelliteKeydownListener: null,
      groupsKeydownListener: null,
    };
  },
  computed: {
    ...mapWritableState(useSatStore, ["availableSatellitesByTag", "availableTags", "enabledSatellites", "enabledTags", "trackedSatellite"]),
    availableSatellites() {
      // Return flat sorted list of all unique satellite names
      const allSats = new Set();
      Object.values(this.availableSatellitesByTag).forEach((sats) => {
        sats.forEach((sat) => allSats.add(sat));
      });
      return [...allSats].sort((a, b) => a.localeCompare(b));
    },
    satellitesEnabledByTag() {
      return this.getSatellitesFromTags(this.enabledTags);
    },
    totalAvailableOptions() {
      return this.availableSatellites.length;
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
    // Clean up listeners if component is destroyed while dropdowns are open
    if (this.scrollListener || this.satelliteKeydownListener) {
      this.onDropdownClose();
    }
    if (this.groupsKeydownListener) {
      this.onGroupsDropdownClose();
    }
  },
  methods: {
    getSatellitesFromTags(taglist) {
      return taglist.map((tag) => this.availableSatellitesByTag[tag] || []).flat();
    },
    activateFocusedItem(index) {
      // Focus and activate the multiselect at the given index
      if (index === 0 && this.$refs.groupsMultiselect) {
        // For groups dropdown, use the activate method
        this.$refs.groupsMultiselect.activate();
        // The @open event will handle emitting dropdown-opened
      } else if (index === 1 && this.$refs.satelliteMultiselect) {
        this.$refs.satelliteMultiselect.activate();
        // The @open event will handle emitting dropdown-opened
      }
    },
    onGroupsDropdownOpen() {
      // Emit event to disable menu navigation
      this.$emit("dropdown-opened");

      // Add keydown listener to handle navigation to satellites dropdown
      this.$nextTick(() => {
        const el = this.$refs.groupsMultiselect?.$el;
        if (el) {
          this.groupsKeydownListener = (event) => {
            if (event.key === "ArrowDown") {
              const multiselect = this.$refs.groupsMultiselect;
              // Check if at last option
              if (multiselect && multiselect.pointer === this.availableTags.length - 1) {
                event.preventDefault();
                event.stopPropagation();
                // Close groups dropdown and open satellites dropdown
                multiselect.deactivate();
                this.$nextTick(() => {
                  this.$refs.satelliteMultiselect?.activate();
                });
              }
            }
          };
          el.addEventListener("keydown", this.groupsKeydownListener, true);
        }
      });
    },
    onGroupsDropdownClose() {
      // Clean up keydown listener
      const el = this.$refs.groupsMultiselect?.$el;
      if (el && this.groupsKeydownListener) {
        el.removeEventListener("keydown", this.groupsKeydownListener, true);
        this.groupsKeydownListener = null;
      }
      // Emit event to re-enable menu navigation
      this.$emit("dropdown-closed");
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

        // Add keydown listener to handle navigation to groups dropdown
        const el = this.$refs.satelliteMultiselect?.$el;
        if (el) {
          this.satelliteKeydownListener = (event) => {
            if (event.key === "ArrowUp") {
              const multiselect = this.$refs.satelliteMultiselect;
              // Check if at first option (pointer === 0 or -1 for no selection)
              if (multiselect && multiselect.pointer <= 0) {
                event.preventDefault();
                event.stopPropagation();
                // Close satellites dropdown and open groups dropdown
                multiselect.deactivate();
                this.$nextTick(() => {
                  this.$refs.groupsMultiselect?.activate();
                });
              }
            }
          };
          el.addEventListener("keydown", this.satelliteKeydownListener, true);
        }
      });
      // Emit event to disable menu navigation
      this.$emit("dropdown-opened");
    },
    onDropdownClose() {
      // Clean up scroll listener when dropdown closes
      const dropdownList = this.$refs.satelliteMultiselect?.$el?.querySelector(".multiselect__content-wrapper");
      if (dropdownList && this.scrollListener) {
        dropdownList.removeEventListener("scroll", this.scrollListener);
        this.scrollListener = null;
      }
      // Clean up keydown listener
      const el = this.$refs.satelliteMultiselect?.$el;
      if (el && this.satelliteKeydownListener) {
        el.removeEventListener("keydown", this.satelliteKeydownListener, true);
        this.satelliteKeydownListener = null;
      }
      // Emit event to re-enable menu navigation
      this.$emit("dropdown-closed");
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
    onSatelliteRightClick(satelliteName) {
      // Enable satellite if not already enabled
      if (!this.allEnabledSatellites.includes(satelliteName)) {
        // Add to enabled satellites list
        const newEnabledSatellites = [...(this.enabledSatellites ?? []), satelliteName];
        cc.sats.enabledSatellites = newEnabledSatellites;
      }

      // Close the dropdown
      this.$refs.satelliteMultiselect?.deactivate();

      // Track the satellite after a short delay to allow it to be created
      this.$nextTick(() => {
        setTimeout(() => {
          const sat = cc.sats.getSatellite(satelliteName);
          if (sat) {
            sat.track();
          }
        }, 100);
      });
    },
  },
};
</script>

<style scoped>
.satellite-select {
  width: 300px;
}

/* Keyboard focus indicator */
.toolbarContent.menu-item-focused {
  outline: 2px solid #4caf50;
  outline-offset: 2px;
  background-color: rgba(76, 175, 80, 0.2) !important;
  border-radius: 4px;
  padding: 4px;
  margin: -4px;
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

/* Make satellite option span full width for right-click target */
.satellite-option {
  display: block;
  width: 100%;
}
</style>
