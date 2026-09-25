/* ========== SHARED MEDIA MANAGEMENT ========== */

const MediaActions = (() => {
  const selected = new Map();
  let toolbar, menu;

  function ensureUI() {
    if (toolbar) return;

    // Floating selection toolbar
    toolbar = document.createElement("div");
    toolbar.className = "media-selection-toolbar";
    toolbar.innerHTML = `
      <span id="selectionCount">0 selected</span>
      <button type="button" id="downloadSelected"> Download</button>
      <button type="button" id="deleteSelected" class="danger-action"> ⌫ Delete</button>
      <button type="button" id="cancelSelection">✕</button>
    `;

    document.body.appendChild(toolbar);

    // Right-click context menu
    menu = document.createElement("div");
    menu.className = "media-context-menu";
    menu.innerHTML = `
  <button type="button" id="contextSelect">

    <svg width="19" height="19"
         viewBox="0 0 24 24"
         fill="none"
         stroke="currentColor"
         stroke-width="2"
         stroke-linecap="round"
         stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4"/>
      <path d="m8 12 3 3 5-6"/>
    </svg>

    <span>Select</span>
  </button>

  <button type="button" id="contextDownload">

    <svg width="19" height="19"
         viewBox="0 0 24 24"
         fill="none"
         stroke="currentColor"
         stroke-width="2"
         stroke-linecap="round"
         stroke-linejoin="round">
      <path d="M12 3v12"/>
      <path d="m7 10 5 5 5-5"/>
      <path d="M4 17v4h16v-4"/>
    </svg>

    <span>Download</span>
  </button>
`;

    document.body.appendChild(menu);

    document.getElementById("cancelSelection").onclick = () => {
      selected.clear();
      document.querySelectorAll(".media-selected").forEach(card => {
        card.classList.remove("media-selected");
      });
      updateToolbar();
    };

    document.getElementById("downloadSelected").onclick = async () => {
      const items = [...selected.values()];

      for (const entry of items) {
        try {
          await download(entry);
        } catch (error) {
          console.error(error);
          alert(`Could not download "${entry.title}".`);
        }
      }
    };

    document.getElementById("deleteSelected").onclick = deleteSelected;

    document.addEventListener("click", event => {
      if (!menu.contains(event.target)) hideMenu();
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") hideMenu();
    });

    window.addEventListener("scroll", hideMenu, true);
    window.addEventListener("resize", hideMenu);
  }

  function hideMenu() {
    if (menu) menu.classList.remove("visible");
  }

  function updateToolbar() {
    document.getElementById("selectionCount").textContent =
      `${selected.size} selected`;

    toolbar.classList.toggle("visible", selected.size > 0);
  }

  function toggleSelection(card, entry) {
    if (selected.has(entry.id)) {
      selected.delete(entry.id);
    } else {
      selected.set(entry.id, entry);
    }

    // Update every visible card representing this memory
    document.querySelectorAll("[data-memory-id]").forEach(element => {
      if (element.dataset.memoryId === String(entry.id)) {
        element.classList.toggle(
          "media-selected",
          selected.has(entry.id)
        );
      }
    });

    updateToolbar();
  }

async function download(entry) {
  if (!entry?.fileName) {
    throw new Error("This memory has no downloadable media.");
  }

  const url = await JournalStore.getMediaURL(entry.fileName);

  if (!url) {
    throw new Error("Original media could not be found.");
  }

  const link = document.createElement("a");

  link.href = url;
  link.download =
    String(entry.fileName).split(/[\\/]/).pop() ||
    `memory-${entry.id}`;

  document.body.appendChild(link);
  link.click();
  link.remove();
}

  async function deleteSelected() {
    const items = [...selected.values()];
    if (!items.length) return;

    if (!confirm(
      `Permanently delete ${items.length} selected ${
        items.length === 1 ? "memory" : "memories"
      } and their media files?`
    )) return;

    const data = JournalStore.getData();
    const deletingIds = new Set(items.map(item => item.id));

    try {
      for (const entry of items) {
        // Don't delete a file used by another memory.
        const usedElsewhere = data.entries.some(other =>
          other.id !== entry.id &&
          !deletingIds.has(other.id) &&
          other.fileName &&
          other.fileName === entry.fileName
        );

        if (entry.fileName && !usedElsewhere) {
          await JournalStore.deleteMedia(entry.fileName);
        }

        data.entries = data.entries.filter(item =>
          item.id !== entry.id
        );

        await JournalStore.save();
      }

      selected.clear();
      window.location.reload();

    } catch (error) {
      console.error("Delete failed:", error);
      alert(
        "Deletion could not be completed. Some earlier items may " +
        "already have been deleted. The page will reload."
      );
      window.location.reload();
    }
  }

  function attach(card, entry) {
    ensureUI();

    card.dataset.memoryId = String(entry.id);
 // Single SVG: red circle + perfectly centered white tick
// One metallic SVG badge per card.
// The circle and checkmark are both inside this single SVG.

if (!card.querySelector(".selection-check")) {

  const indicator = document.createElement("div");

  indicator.className = "selection-check";

  indicator.innerHTML = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="34"
      height="34"
      viewBox="0 0 34 34"
      fill="none"
      aria-hidden="true"
    >

      <!-- Outer metallic rim -->
      <circle
        cx="17"
        cy="17"
        r="15"
        fill="#C6CDD6"
        stroke="#F7F9FC"
        stroke-width="1"
      />

      <!-- Dark gunmetal inner surface -->
      <circle
        cx="17"
        cy="17"
        r="12.5"
        fill="#303640"
        stroke="#858E9B"
        stroke-width="1"
      />

      <!-- Metallic highlight -->
      <path
        d="M7.5 12.5 A12.5 12.5 0 0 1 26.5 12.5"
        stroke="#FFFFFF"
        stroke-opacity="0.65"
        stroke-width="1.2"
        stroke-linecap="round"
      />

      <!-- Single centered metallic checkmark -->
      <path
        d="M10 17.2L14.8 21.5L24 12"
        stroke="#EDF2F8"
        stroke-width="3.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

    </svg>
  `;

  card.appendChild(indicator);

}

    card.classList.toggle(
      "media-selected",
      selected.has(entry.id)
    );

    // Preserve the card's EXISTING click-to-open/reveal handler.
    const originalClick = card.onclick;

    card.onclick = event => {
      if (selected.size > 0) {
        toggleSelection(card, entry);
        return;
      }

      if (originalClick) {
        originalClick.call(card, event);
      }
    };

    card.addEventListener("contextmenu", event => {
      event.preventDefault();

      hideMenu();

      const selectButton =
        document.getElementById("contextSelect");

      const downloadButton =
        document.getElementById("contextDownload");

      selectButton.querySelector("span").textContent =
  selected.has(entry.id) ? "Deselect" : "Select";

      selectButton.onclick = () => {
        toggleSelection(card, entry);
        hideMenu();
      };

      downloadButton.disabled = !entry.fileName;

      downloadButton.onclick = async () => {
        hideMenu();

        try {
          await download(entry);
        } catch (error) {
          console.error(error);
          alert("This media could not be downloaded.");
        }
      };

      // Keep menu inside the visible browser window.
      menu.classList.add("visible");

      const width = menu.offsetWidth;
      const height = menu.offsetHeight;

      menu.style.left =
        Math.max(8, Math.min(event.clientX, innerWidth - width - 8)) + "px";

      menu.style.top =
        Math.max(8, Math.min(event.clientY, innerHeight - height - 8)) + "px";
    });
  }

  return { attach, download };
})();