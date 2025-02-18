// Function to simulate a click on the door
const clickDoor = () => {
    const door = document.querySelector('img[src="/door.png"]'); // Selector for the door image
    if (door) {
        door.click();
        console.log('Clicked the door!');
    } else {
        console.error('Door not found!');
    }
};

// Function to buy an upgrade
const buyUpgrade = (upgradeElement) => {
    if (upgradeElement && !upgradeElement.classList.contains('opacity-50')) {
        upgradeElement.click();
        console.log('Bought an upgrade!');
    }
};

// Function to check if an upgrade is available and buy it
const checkAndBuyUpgrades = () => {
    const upgrades = document.querySelectorAll('.p-3.cursor-pointer'); // Selector for upgrade elements
    upgrades.forEach((upgrade) => {
        buyUpgrade(upgrade);
    });
};

// Wait for the game to load and start automation
const waitForGame = () => {
    const gameContainer = document.querySelector('.flex.min-h-screen'); // Selector for the game container
    if (gameContainer) {
        console.log('Game loaded! Starting automation...');
        automateGame();
    } else {
        console.log('Waiting for the game to load...');
        setTimeout(waitForGame, 100); // Check again after 100ms
    }
};

// Main loop to automate the game
const automateGame = () => {
    clickDoor();
    checkAndBuyUpgrades();

    // Repeat the loop every 100ms
    setTimeout(automateGame, 100);
};

// Start waiting for the game to load
waitForGame();