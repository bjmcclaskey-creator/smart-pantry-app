/*
 * Smart Pantry App
 *
 * This single page application keeps track of the food items you have at home,
 * suggests recipes you can cook with those items, integrates with Google
 * identity services for account linking, and reminds you when items are
 * expiring or need to be restocked. Barcode scanning is supported through
 * the ZXing library loaded via CDN. A minimal price lookup table is
 * included to demonstrate how the app could recommend where to buy items at
 * the lowest price; hook this up to a real API when available.
 */

(() => {
  // DOM container
  const app = document.getElementById("app");

  // Load user from localStorage if previously signed in
  let user = null;
  try {
    const storedUser = localStorage.getItem("googleUser");
    if (storedUser) user = JSON.parse(storedUser);
  } catch (e) {
    console.warn("Unable to parse stored user", e);
  }

  // Inventory state: array of objects { id, name, quantity, expirationDate, barcode, regular }
  let inventory = [];
  // Load inventory from localStorage
  try {
    const stored = localStorage.getItem("inventory");
    if (stored) inventory = JSON.parse(stored);
  } catch (e) {
    console.warn("Unable to parse stored inventory", e);
  }

  // Static recipe list (for demonstration). In a real application you might
  // fetch recipes from an API and cache them locally. Each recipe has a
  // name, ingredients (array of strings), and instructions (string).
  const recipes = [
    {
      name: "Spaghetti Marinara",
      ingredients: ["spaghetti", "tomato sauce", "garlic", "olive oil"],
      instructions:
        "1. Cook spaghetti according to package directions.\n2. Heat tomato sauce with minced garlic in a pan with olive oil.\n3. Combine spaghetti and sauce, toss well and serve.",
    },
    {
      name: "Peanut Butter Sandwich",
      ingredients: ["bread", "peanut butter", "jelly"],
      instructions:
        "Spread peanut butter and jelly on slices of bread and assemble. Cut diagonally and serve.",
    },
    {
      name: "Omelette",
      ingredients: ["eggs", "milk", "cheese", "salt"],
      instructions:
        "1. Beat eggs with a splash of milk and a pinch of salt.\n2. Pour mixture into a heated, greased pan.\n3. When partly set, sprinkle cheese and fold in half. Cook until done.",
    },
    {
      name: "Guacamole",
      ingredients: ["avocado", "lime", "salt", "tomato", "onion"],
      instructions:
        "1. Mash avocado flesh.\n2. Stir in chopped tomato, onion, salt, and lime juice.\n3. Serve with chips.",
    },
    {
      name: "Caprese Salad",
      ingredients: ["tomato", "mozzarella", "basil", "olive oil", "salt"],
      instructions:
        "1. Slice tomatoes and mozzarella.\n2. Layer alternately on a plate with basil leaves.\n3. Drizzle olive oil and sprinkle salt before serving.",
    },
    {
      name: "Fruit Smoothie",
      ingredients: ["banana", "milk", "frozen berries", "honey"],
      instructions:
        "Blend banana, milk, frozen berries, and honey until smooth. Serve chilled.",
    },
    {
      name: "Chicken Stir‑Fry",
      ingredients: ["chicken breast", "soy sauce", "vegetables", "garlic", "rice"],
      instructions:
        "1. Cook rice according to package directions.\n2. Stir‑fry sliced chicken in oil until browned.\n3. Add vegetables and minced garlic and cook until tender.\n4. Stir in soy sauce and serve over rice.",
    },
  ];

  // Static price data. Each key corresponds to an item name and maps to an
  // array of objects with store and price. This is only a sample; in a real
  // application you would query a grocery price API or database.
  const priceData = {
    bread: [
      { store: "Walmart", price: 1.5 },
      { store: "Target", price: 1.4 },
      { store: "Publix", price: 1.6 },
    ],
    milk: [
      { store: "Walmart", price: 2.0 },
      { store: "Target", price: 2.2 },
      { store: "Costco", price: 1.8 },
    ],
    eggs: [
      { store: "Publix", price: 2.5 },
      { store: "Walmart", price: 2.3 },
      { store: "Target", price: 2.6 },
    ],
    "tomato sauce": [
      { store: "Publix", price: 1.8 },
      { store: "Walmart", price: 1.6 },
      { store: "Target", price: 1.7 },
    ],
    spaghetti: [
      { store: "Publix", price: 1.2 },
      { store: "Walmart", price: 1.1 },
      { store: "Target", price: 1.3 },
    ],
    cheese: [
      { store: "Publix", price: 2.9 },
      { store: "Walmart", price: 2.7 },
      { store: "Costco", price: 2.5 },
    ],
    bananas: [
      { store: "Publix", price: 0.5 },
      { store: "Walmart", price: 0.45 },
      { store: "Costco", price: 0.4 },
    ],
  };

  /**
   * Save current inventory state to localStorage.
   */
  function saveInventory() {
    localStorage.setItem("inventory", JSON.stringify(inventory));
  }

  /**
   * Utility: generate a UUID for new items. This uses a simple random
   * implementation adequate for this application.
   */
  function generateId() {
    return (
      Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
    );
  }

  /**
   * Calculate difference in days between two Date objects.
   * Returns positive numbers if end is after start, negative otherwise.
   */
  function daysBetween(start, end) {
    const msPerDay = 1000 * 60 * 60 * 24;
    const utcStart = Date.UTC(
      start.getFullYear(),
      start.getMonth(),
      start.getDate()
    );
    const utcEnd = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.floor((utcEnd - utcStart) / msPerDay);
  }

  /**
   * Determine soon to expire items. Returns array of objects with the item
   * and days until expiration (negative if past due). We consider items
   * expiring within 5 days as soon to expire.
   */
  function getSoonExpiringItems() {
    const now = new Date();
    return inventory
      .filter((item) => item.expirationDate)
      .map((item) => {
        const expireDate = new Date(item.expirationDate);
        const daysLeft = daysBetween(now, expireDate);
        return { item, daysLeft };
      })
      .filter((entry) => entry.daysLeft <= 5);
  }

  /**
   * Determine items that should be restocked. Items flagged as regular and
   * whose quantity is 0 are suggested for restock. You can modify the
   * heuristic to suit your needs.
   */
  function getRestockItems() {
    return inventory.filter((item) => item.regular && item.quantity <= 0);
  }

  /**
   * Determine recipe suggestions based on current inventory. Returns an
   * array of objects { recipe, missing } where missing is array of
   * ingredients not present in the inventory or insufficient quantity.
   */
  function getRecipeSuggestions() {
    return recipes.map((recipe) => {
      const missing = [];
      recipe.ingredients.forEach((ingredient) => {
        // find if ingredient exists in inventory by matching name (case‑insensitive)
        const found = inventory.find(
          (item) => item.name.toLowerCase() === ingredient.toLowerCase()
        );
        if (!found || found.quantity <= 0) {
          missing.push(ingredient);
        }
      });
      return { recipe, missing };
    });
  }

  /**
   * Suggest the cheapest store for a given item based on the static priceData.
   */
  function getCheapestStoreFor(itemName) {
    const list = priceData[itemName.toLowerCase()];
    if (!list || list.length === 0) return null;
    let cheapest = list[0];
    list.forEach((entry) => {
      if (entry.price < cheapest.price) cheapest = entry;
    });
    return cheapest;
  }

  /**
   * Render the application. We build the HTML structure using template
   * literals and attach event handlers after insertion. This function is
   * idempotent and will re-render the entire UI whenever state changes.
   */
  function render() {
    // Construct sign‑in/out section
    let authSection = "";
    if (!user) {
      // Show Google sign‑in button placeholder; the actual button will be
      // rendered by google.accounts.id.renderButton in onReady.
      authSection = `
        <div id="auth" class="mb-4 p-4 bg-white rounded shadow">
          <h2 class="text-lg font-semibold mb-2">Sign in</h2>
          <div id="google-signin-button"></div>
          <p class="text-sm mt-2 text-gray-500">
            Sign in with your Google account to sync your pantry across devices
            (including smart refrigerators) and enable reminders.
          </p>
        </div>`;
    } else {
      authSection = `
        <div class="mb-4 p-4 bg-white rounded shadow flex items-center justify-between">
          <div>
            <p class="font-semibold">Signed in as ${user.name || user.email || "User"}</p>
            <p class="text-sm text-gray-500">${user.email || ""}</p>
          </div>
          <button id="signout" class="text-blue-600 hover:underline">Sign out</button>
        </div>`;
    }

    // Build inventory table
    const inventoryRows = inventory
      .map((item) => {
        const expireText = item.expirationDate
          ? new Date(item.expirationDate).toLocaleDateString()
          : "";
        return `
          <tr class="border-b last:border-none">
            <td class="py-1 px-2">${item.name}</td>
            <td class="py-1 px-2 text-center">${item.quantity}</td>
            <td class="py-1 px-2 text-center">${expireText}</td>
            <td class="py-1 px-2 text-right">
              <button data-id="${item.id}" class="use-button text-blue-600 hover:underline mr-2">Use</button>
              <button data-id="${item.id}" class="delete-button text-red-600 hover:underline">Delete</button>
            </td>
          </tr>`;
      })
      .join("");
    const inventorySection = `
      <div class="mb-4 p-4 bg-white rounded shadow">
        <h2 class="text-lg font-semibold mb-2">Your Inventory</h2>
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b font-medium">
              <th class="py-1 px-2">Item</th>
              <th class="py-1 px-2 text-center">Qty</th>
              <th class="py-1 px-2 text-center">Expires</th>
              <th class="py-1 px-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>${inventoryRows || `<tr><td colspan="4" class="py-2 text-center text-gray-500">No items yet</td></tr>`}</tbody>
        </table>
      </div>`;

    // Build add item form
    const addItemSection = `
      <div class="mb-4 p-4 bg-white rounded shadow">
        <h2 class="text-lg font-semibold mb-2">Add Item</h2>
        <form id="add-form" class="space-y-2">
          <div>
            <label class="block text-sm font-medium">Name</label>
            <input type="text" name="name" required class="w-full p-1 border rounded" />
          </div>
          <div>
            <label class="block text-sm font-medium">Quantity</label>
            <input type="number" name="quantity" min="1" value="1" required class="w-full p-1 border rounded" />
          </div>
          <div>
            <label class="block text-sm font-medium">Expiration Date</label>
            <input type="date" name="expirationDate" class="w-full p-1 border rounded" />
          </div>
          <div class="flex items-center">
            <input type="checkbox" name="regular" id="regular" class="mr-2" />
            <label for="regular" class="text-sm">Mark as regularly used item (notify to restock when quantity reaches 0)</label>
          </div>
          <div class="flex items-center space-x-3">
            <button type="submit" class="bg-blue-600 text-white px-4 py-1 rounded">Add</button>
            <button type="button" id="scan-button" class="bg-green-600 text-white px-4 py-1 rounded">Scan Barcode</button>
          </div>
        </form>
        <div id="scan-container" class="mt-4 hidden">
          <div class="mb-2 font-medium">Barcode Scanner</div>
          <video id="video" class="w-full h-48 bg-black rounded"></video>
          <p id="scan-status" class="text-sm text-gray-500 mt-2">Scanning… align the barcode within the frame.</p>
          <button id="stop-scan" class="mt-2 bg-gray-300 px-3 py-1 rounded">Stop</button>
        </div>
      </div>`;

    // Build reminders: soon to expire and restock lists
    const soonItems = getSoonExpiringItems();
    const soonList = soonItems
      .map(({ item, daysLeft }) => {
        const store = getCheapestStoreFor(item.name.toLowerCase());
        return `<li class="mb-1">${item.name} expires in ${daysLeft >= 0 ? daysLeft : 0} days${
          store
            ? ` — cheapest price at <strong>${store.store}</strong> ($${store.price.toFixed(
                2
              )})`
            : ""
        }</li>`;
      })
      .join("");
    const restock = getRestockItems();
    const restockList = restock
      .map((item) => {
        const store = getCheapestStoreFor(item.name.toLowerCase());
        return `<li class="mb-1">${item.name}${
          store
            ? ` — cheapest price at <strong>${store.store}</strong> ($${store.price.toFixed(
                2
              )})`
            : ""
        }</li>`;
      })
      .join("");
    const remindersSection = `
      <div class="mb-4 p-4 bg-white rounded shadow">
        <h2 class="text-lg font-semibold mb-2">Reminders</h2>
        <div class="mb-2">
          <h3 class="font-medium">Soon to expire</h3>
          <ul class="list-disc list-inside text-sm">${soonList || `<li>None</li>`}</ul>
        </div>
        <div>
          <h3 class="font-medium">Restock</h3>
          <ul class="list-disc list-inside text-sm">${restockList || `<li>None</li>`}</ul>
        </div>
      </div>`;

    // Build recipe suggestions table
    const suggestions = getRecipeSuggestions();
    const suggestionsRows = suggestions
      .map(({ recipe, missing }) => {
        const canCook = missing.length === 0;
        return `
          <tr class="border-b last:border-none">
            <td class="py-1 px-2">${recipe.name}</td>
            <td class="py-1 px-2">${recipe.ingredients.join(", ")}</td>
            <td class="py-1 px-2">${
              missing.length
                ? `<span class="text-red-600">Missing: ${missing.join(", ")}</span>`
                : `<span class="text-green-600">All ingredients available</span>`
            }</td>
            <td class="py-1 px-2 text-right">
              <button data-name="${recipe.name}" class="cook-button text-blue-600 hover:underline mr-2" ${
                canCook ? "" : "disabled"
              }>Cook</button>
              <button data-name="${recipe.name}" class="view-button text-gray-600 hover:underline">View</button>
            </td>
          </tr>`;
      })
      .join("");
    const recipesSection = `
      <div class="mb-4 p-4 bg-white rounded shadow">
        <h2 class="text-lg font-semibold mb-2">Recipe Suggestions</h2>
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b font-medium">
              <th class="py-1 px-2 w-1/5">Recipe</th>
              <th class="py-1 px-2 w-2/5">Ingredients</th>
              <th class="py-1 px-2 w-1/4">Availability</th>
              <th class="py-1 px-2 text-right w-1/4">Actions</th>
            </tr>
          </thead>
          <tbody>${suggestionsRows}</tbody>
        </table>
      </div>`;

    app.innerHTML = `${authSection}${inventorySection}${addItemSection}${remindersSection}${recipesSection}`;

    // Attach event listeners
    // Sign out
    const signoutBtn = document.getElementById("signout");
    if (signoutBtn) {
      signoutBtn.addEventListener("click", () => {
        user = null;
        localStorage.removeItem("googleUser");
        render();
      });
    }
    // Add item form submission
    const addForm = document.getElementById("add-form");
    addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const formData = new FormData(addForm);
      const name = formData.get("name").trim();
      const quantity = parseInt(formData.get("quantity"), 10) || 0;
      const expirationDate = formData.get("expirationDate");
      const regular = formData.get("regular") === "on";
      if (!name) return;
      inventory.push({
        id: generateId(),
        name,
        quantity,
        expirationDate: expirationDate || null,
        barcode: null,
        regular,
      });
      saveInventory();
      addForm.reset();
      render();
    });
    // Item use button
    document.querySelectorAll(".use-button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = btn.getAttribute("data-id");
        const item = inventory.find((itm) => itm.id === id);
        if (item) {
          if (item.quantity > 0) item.quantity -= 1;
          saveInventory();
          render();
        }
      });
    });
    // Item delete button
    document.querySelectorAll(".delete-button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = btn.getAttribute("data-id");
        inventory = inventory.filter((itm) => itm.id !== id);
        saveInventory();
        render();
      });
    });
    // Recipe view button
    document.querySelectorAll(".view-button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const recipeName = btn.getAttribute("data-name");
        const recipe = recipes.find((r) => r.name === recipeName);
        if (recipe) {
          // Simple alert to show instructions; you may replace this with a modal
          alert(`${recipe.name}\n\nIngredients:\n${recipe.ingredients.join(
            ", "
          )}\n\nInstructions:\n${recipe.instructions}`);
        }
      });
    });
    // Recipe cook button
    document.querySelectorAll(".cook-button").forEach((btn) => {
      if (btn.getAttribute("disabled") !== null) return;
      btn.addEventListener("click", () => {
        const recipeName = btn.getAttribute("data-name");
        const recipe = recipes.find((r) => r.name === recipeName);
        if (!recipe) return;
        // Deduct 1 quantity of each ingredient used
        recipe.ingredients.forEach((ing) => {
          const item = inventory.find(
            (itm) => itm.name.toLowerCase() === ing.toLowerCase()
          );
          if (item && item.quantity > 0) item.quantity -= 1;
        });
        saveInventory();
        render();
      });
    });
    // Barcode scanning button
    const scanButton = document.getElementById("scan-button");
    const scanContainer = document.getElementById("scan-container");
    const videoElement = document.getElementById("video");
    const scanStatus = document.getElementById("scan-status");
    const stopScanBtn = document.getElementById("stop-scan");
    let barcodeReader = null;
    let stream = null;
    scanButton.addEventListener("click", async () => {
      scanContainer.classList.remove("hidden");
      // Initialize the ZXing barcode reader if not already created
      if (!barcodeReader) {
        try {
          barcodeReader = new ZXing.BrowserMultiFormatReader();
        } catch (err) {
          console.error("Barcode reader init failed", err);
          scanStatus.textContent = "Barcode scanner not supported in this browser.";
          return;
        }
      }
      // Start camera
      try {
        // Use default camera; you may choose a specific device by passing its deviceId
        const result = await barcodeReader.decodeOnceFromVideoDevice(null, videoElement);
        // result.text contains the scanned barcode value
        scanStatus.textContent = `Scanned code: ${result.text}. Populating name field.`;
        // Populate the name field with scanned code; in a real app, you would
        // look up the product info from a database using the barcode
        const nameInput = addForm.querySelector("input[name='name']");
        nameInput.value = result.text;
        // Stop the camera
        barcodeReader.reset();
        scanContainer.classList.add("hidden");
      } catch (err) {
        console.error(err);
        scanStatus.textContent = "Scanning cancelled or failed.";
      }
    });
    // Stop scanning
    stopScanBtn.addEventListener("click", () => {
      if (barcodeReader) barcodeReader.reset();
      scanContainer.classList.add("hidden");
    });

    // Render Google sign‑in button if user not signed in
    if (!user && window.google && google.accounts && google.accounts.id) {
      // Delay rendering of button until container exists
      google.accounts.id.initialize({
        client_id: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
        callback: handleCredentialResponse,
      });
      google.accounts.id.renderButton(document.getElementById("google-signin-button"), {
        theme: "outline",
        size: "large",
        type: "standard",
      });
    }
  }

  /**
   * Handle Google sign‑in credential response. Decodes the JWT payload
   * to extract basic profile information (name and email). Stores the
   * information in localStorage and triggers a re-render.
   */
  function handleCredentialResponse(response) {
    try {
      const payload = JSON.parse(atob(response.credential.split(".")[1]));
      user = {
        name: payload.name,
        email: payload.email,
        sub: payload.sub,
      };
      localStorage.setItem("googleUser", JSON.stringify(user));
    } catch (err) {
      console.error("Failed to decode credential", err);
    }
    render();
  }

  // Initial render
  render();
})();
