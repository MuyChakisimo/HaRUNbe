// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. GET ALL HTML ELEMENTS ---
    const screens = {
        mainMenu: document.getElementById('main-menu-screen'),
        game: document.getElementById('game-container'),
        highScore: document.getElementById('highscore-screen'),
        enterScore: document.getElementById('enter-highscore-screen'),
        finalScore: document.getElementById('final-score-screen')
    };
    const buttons = {
        start: document.getElementById('start-btn'),
        viewScores: document.getElementById('highscore-btn'),
        menuFromScores: document.getElementById('menu-btn-from-scores'),
        submitScore: document.getElementById('submit-score-btn'),
        restart: document.getElementById('restart-btn'),
        menuFromGameOver: document.getElementById('menu-btn-from-gameover'),
        pause: document.getElementById('pause-btn'),
        resume: document.getElementById('resume-btn'),
        returnTitle: document.getElementById('return-title-btn')
    };
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const grass = document.getElementById('grass');
    const pauseOverlay = document.getElementById('pause-overlay');
    const overlayText = document.getElementById('overlay-text');
    const scoreList = document.getElementById('score-list');
    const finalScoreInputDisplay = document.getElementById('final-score-input');
    const finalScoreDisplay = document.getElementById('final-score-display');
    const nameInput = document.getElementById('name-input');

    // --- 2. ASSET LOADER ---
    let assets = {};
    const assetList = [
        { name: "playerImage",   src: "Assets/Player/128x128DefaultGorilla.png" },
        { name: "bgClearSky",    src: "Assets/Scenery/ClearSky.png" },
        { name: "bgStarryNight", src: "Assets/Scenery/StarryNight.png" },
        { name: "cloudDay",      src: "Assets/Scenery/128x128DayCloud.png" },
        { name: "cloudNight",    src: "Assets/Scenery/128x128NightCloud.png" },
        { name: "sun",           src: "Assets/Scenery/128x128Sun.png" },
        { name: "moon",          src: "Assets/Scenery/128x128Moon.png" },
        { name: "banana",        src: "Assets/Items/128x128Banana.png" },
        { name: "tiger",         src: "Assets/Enemies/128x128Tiger.png" },
        { name: "hawk",          src: "Assets/Enemies/128x128Hawk.png" }
    ];
    let assetsLoaded = 0;

    function loadAllAssets(callback) {
        console.log("Loading assets...");
        assetList.forEach(asset => {
            const img = new Image();
            img.src = asset.src;
            img.onload = () => {
                console.log(`Loaded: ${asset.name}`);
                assets[asset.name] = img;
                assetsLoaded++;
                if (assetsLoaded === assetList.length) {
                    console.log("All assets loaded.");
                    callback();
                }
            };
            img.onerror = () => console.error("Error loading asset: " + asset.src);
        });
    }

    // --- 3. GAME STATE & VARIABLES ---
    let gameState = 'MENU';
    let animationFrameId = null;
    let countdownIntervalId = null;
    let highScores = [];

    const gravity = 0.3;
    const jumpPower = -15;
    let grassHeight = 0, groundLevel = 0;
    let isJumping = false;

    const SUN_MOON_SPEED = 0.02, CLOUD_SPEED = 0.05, ITEM_SPEED = 0.8, ENEMY_SPEED = 3; // Faster
    let speedMultiplier = 1.0;

    let player = {}, scenery = {}, items = [], enemies = [];
    let timeToNextBanana = 0, timeToNextEnemy = 0, score = 0;
    let currentCycleState = 'DAY', nightOpacity = 0, dayOpacity = 1;

    // --- 4. CORE FUNCTIONS ---
    function resizeCanvas() {
        console.log("Resizing canvas..."); // Log start
        const clientWidth = canvas.clientWidth;
        const clientHeight = canvas.clientHeight;

        // Check for valid dimensions
        if (clientWidth <= 0 || clientHeight <= 0) {
            console.warn("Canvas dimensions are zero or negative. Skipping resize logic.");
            return; // Exit if dimensions are invalid
        }

        canvas.width = clientWidth;
        canvas.height = clientHeight;
        grassHeight = canvas.height * 0.20;
        groundLevel = canvas.height - grassHeight;

        console.log(`Canvas resized: ${canvas.width}x${canvas.height}, Ground: ${groundLevel}`); // Log dimensions

        // Adjust player position if player object exists and ground level is set
        if (player.y !== undefined && groundLevel > 0) {
            if (player.y + player.height > groundLevel || player.y === 0) { // Adjust if below ground or at initial 0
                player.y = groundLevel - player.height;
                player.velocityY = 0;
                player.isOnGround = true;
                console.log(`Adjusted player Y to ${player.y}`); // Log player adjustment
            }
        }

        // --- ENSURE SUN/MOON UPDATE ---
        // Update sun/moon position if scenery objects exist AND canvas has valid width
        if (scenery.sun && canvas.width > 0 && scenery.sun.width > 0) { // Check sun width too
            scenery.sun.x = (canvas.width / 2) - (scenery.sun.width / 2);
            console.log(`Sun X set to: ${scenery.sun.x}`); // Debug log
        }
        if (scenery.moon && canvas.width > 0 && scenery.moon.width > 0) { // Check moon width too
            scenery.moon.x = (canvas.width / 2) - (scenery.moon.width / 2);
            console.log(`Moon X set to: ${scenery.moon.x}`); // Debug log
        }
        // --- END ENSURE ---
    }

    function jump() {
        if (gameState === 'PLAYING' && player.isOnGround) {
            console.log("Jump!");
            player.velocityY = jumpPower;
            player.isOnGround = false;
        }
    }

    function init() {
        console.log("Initializing listeners and first resize.");
        setupButtonListeners();
        loadHighScores();
        resizeCanvas(); // Initial resize after setup
        console.log("Initialization complete. Waiting for user action.");
    }

    function setupButtonListeners() {
        console.log("Setting up button listeners...");
        buttons.start.addEventListener('click', startGame);
        buttons.viewScores.addEventListener('click', showHighScoreScreen);
        buttons.menuFromScores.addEventListener('click', () => showScreen('mainMenu'));
        buttons.restart.addEventListener('click', startGame);
        buttons.menuFromGameOver.addEventListener('click', () => showScreen('mainMenu'));
        buttons.pause.addEventListener('click', togglePause);
        buttons.submitScore.addEventListener('click', submitHighScore);
        buttons.resume.addEventListener('click', resumeGame);
        buttons.returnTitle.addEventListener('click', returnToTitle);
    }

    function showScreen(screenId) {
        console.log(`Showing screen: ${screenId}`);
        for (let key in screens) screens[key].classList.remove('active');
        screens[screenId].classList.add('active');
    }

    // --- 5. GAME START & RESET ---
    function startGame() {
        console.log("--- Starting game sequence ---");
        cancelAnimationFrame(animationFrameId);
        clearInterval(countdownIntervalId); countdownIntervalId = null;
        pauseOverlay.style.display = 'none';

        // 1. Show screen first to ensure elements are measurable
        showScreen('game');

        // 2. NOW resize and reset
        console.log("Calling resizeCanvas from startGame...");
        resizeCanvas(); // Ensure dimensions are set based on VISIBLE element
        console.log("Calling resetGame from startGame...");
        resetGame(); // Reset objects based on dimensions

        // 3. Force groundLevel calc and set player Y
        groundLevel = canvas.height - grassHeight; // Recalculate AFTER resize
        if (groundLevel > 0 && player.height > 0) {
            player.y = groundLevel - player.height;
            player.isOnGround = true;
            console.log("Player Y set in startGame using groundLevel:", groundLevel, "Player Y:", player.y);
        } else {
             console.error("Ground level STILL not set or invalid during startGame! Canvas H:", canvas.height, "Grass H:", grassHeight);
             // Provide a more sensible fallback based on potentially available height
             const fallbackGround = canvas.clientHeight > 0 ? canvas.clientHeight * 0.8 : 150; // Use clientHeight or a default
             player.y = fallbackGround - (player.height || 60); // Use player height or default
             player.isOnGround = true;
             console.log(`Applied fallback Player Y: ${player.y}`);
        }

        gameState = 'PLAYING';
        console.log("Starting main game loop...");
        // Use rAF to ensure rendering context is ready
        animationFrameId = requestAnimationFrame(mainGameLoop);
    }

    function resetGame() {
        console.log("Resetting game variables...");
        isJumping = false; speedMultiplier = 1.0; score = 0;
        items = []; enemies = [];
        // Initialize player with default y=0, will be set correctly in startGame
        player = { x: 150, y: 0, width: 60, height: 60, velocityY: 0, isOnGround: true };
        scenery = { sun: { x: 0, y: -200, width: 100, height: 100 }, moon: { x: 0, y: -200, width: 100, height: 100 }, clouds: [] };
        timeToNextBanana = 100; timeToNextEnemy = 200;
        currentCycleState = 'DAY'; nightOpacity = 0; dayOpacity = 1;
        scenery.clouds = [];
        // Add clouds only if canvas has dimensions
        if (canvas.width > 0 && canvas.height > 0) {
             for (let i = 0; i < 3; i++) {
                 scenery.clouds.push({ x: Math.random() * canvas.width, y: Math.random() * (canvas.height * 0.4), width: 128, height: 70 });
             }
        }
        // Set sun/moon position only if groundLevel is valid
        if (scenery.sun && groundLevel > 0) {
            scenery.sun.y = Math.random() * (groundLevel - scenery.sun.height);
            scenery.moon.y = -200;
        } else if (scenery.sun) {
             // Fallback position if groundLevel isn't ready
             scenery.sun.y = 50;
             scenery.moon.y = -200;
        }
        console.log("Game reset complete.");
    }


    // --- 6. HIGH SCORE LOGIC ---
    function loadHighScores() {
        console.log("Loading high scores...");
        const scores = localStorage.getItem('haRUNbeHighScores');
        highScores = scores ? JSON.parse(scores) : [];
        updateHighScoreDisplay();
    }
    function saveHighScores() {
        console.log("Saving high scores...");
        localStorage.setItem('haRUNbeHighScores', JSON.stringify(highScores));
    }
    function updateHighScoreDisplay() {
        scoreList.innerHTML = '';
        if (highScores.length === 0) {
             scoreList.innerHTML = '<li>No scores yet!</li>';
             return;
        }
        highScores.forEach(s => { const li = document.createElement('li'); li.textContent = `${s.name}: ${s.score}`; scoreList.appendChild(li); });
    }
    function showHighScoreScreen() {
        loadHighScores();
        showScreen('highScore');
    }
    function isNewHighScore() {
        if (highScores.length < 5) return true;
        return score > highScores[highScores.length - 1].score;
    }
    function submitHighScore() {
        const name = nameInput.value.trim() || 'Harunbe';
        // Ensure score is a number before saving
        const finalScore = Math.floor(score);
        highScores.push({ name, score: finalScore });
        highScores.sort((a,b)=>b.score-a.score);
        highScores = highScores.slice(0,5);
        saveHighScores();
        nameInput.value = '';
        showHighScoreScreen();
    }

    // --- 7. PAUSE & RESUME LOGIC ---
    function togglePause() {
        console.log(`Toggle Pause called. Current state: ${gameState}`);
        if (gameState === 'PLAYING') {
            pauseGame();
        }
        // Resume is handled explicitly by the resume button
    }
    function pauseGame() {
        if (gameState !== 'PLAYING') return;
        console.log("Pausing game...");
        gameState = 'PAUSED';
        cancelAnimationFrame(animationFrameId); // Stop the animation loop
        clearInterval(countdownIntervalId); // Clear any active countdown
        countdownIntervalId = null;
        overlayText.textContent = "PAUSED";
        const pbContainer = document.getElementById('pause-buttons');
        if (pbContainer) pbContainer.style.display = 'flex'; // Ensure buttons are visible
        pauseOverlay.style.display = 'flex'; // Show the overlay
        console.log("Game paused.");
    }

    function resumeGame() {
        if (gameState !== 'PAUSED' || countdownIntervalId) return;

        console.log("Attempting to resume..."); // Log entry
        overlayText.textContent = ""; // Clear PAUSED

        // Get element reference *inside* function
        const currentPauseButtonsContainer = document.getElementById('pause-buttons'); // Get it ONCE here

        if (currentPauseButtonsContainer) {
            console.log("Found pause-buttons directly.");
            currentPauseButtonsContainer.style.display = 'none'; // Hide buttons
        } else {
            // Log if not found, but proceed with countdown
            console.error("resumeGame: Could not find pause buttons container!");
        }

        let count = 3;
        overlayText.textContent = count;
        console.log(`Starting countdown: ${count}`);

        countdownIntervalId = setInterval(() => {
            count--;
            console.log(`Countdown: ${count > 0 ? count : 'Resume!'}`);
            if (count > 0) {
                overlayText.textContent = count;
            } else {
                clearInterval(countdownIntervalId); countdownIntervalId = null;
                pauseOverlay.style.display = 'none'; // Hide overlay

                // --- MODIFICATION: Use the reference we already got ---
                // Re-find and show buttons (using the same robust method)
                // const finalPauseButtonsContainer = document.getElementById('pause-buttons'); // DON'T find it again
                if (currentPauseButtonsContainer) { // Use the variable from the outer scope
                    currentPauseButtonsContainer.style.display = 'flex'; // Show buttons again
                } else {
                     console.error("resumeGame countdown: Could not find pause buttons container to re-display!"); // Keep error log just in case
                }
                // --- END MODIFICATION ---

                gameState = 'PLAYING';
                console.log("Resuming game loop...");
                animationFrameId = requestAnimationFrame(mainGameLoop); // Restart loop
            }
        }, 1000);
    }

    function returnToTitle() {
        console.log("Returning to title screen...");
        clearInterval(countdownIntervalId); countdownIntervalId = null;
        cancelAnimationFrame(animationFrameId);
        gameState = 'MENU';
        pauseOverlay.style.display = 'none';
        showScreen('mainMenu');
    }

    // --- 8. GAME OVER LOGIC ---
    function startGameOverSequence() {
        console.log("Starting game over sequence...");
        gameState = 'DYING';
        isJumping = false; // Prevent jumping while dying
    }
    function handleGameOver() {
        console.log("Handling game over. Final Score:", Math.floor(score));
        gameState = 'GAMEOVER'; // Ensure state is correct
        cancelAnimationFrame(animationFrameId); // Make sure loop is stopped
        if (isNewHighScore()) {
            console.log("New high score!");
            finalScoreInputDisplay.textContent = Math.floor(score);
            showScreen('enterScore');
        } else {
            console.log("Not a high score.");
            finalScoreDisplay.textContent = Math.floor(score);
            showScreen('finalScore');
        }
    }

    // --- 9. COLLISION ---
    function checkCollision(rect1, rect2) {
        // Add safety checks for properties existence
        if (!rect1 || !rect2 ||
            rect1.x === undefined || rect1.y === undefined || rect1.width === undefined || rect1.height === undefined ||
            rect2.x === undefined || rect2.y === undefined || rect2.width === undefined || rect2.height === undefined) {
             // console.warn("Collision check failed: Invalid rect data", rect1, rect2);
             return false;
        }
        return !(rect2.x > rect1.x + rect1.width ||
                 rect2.x + rect2.width < rect1.x ||
                 rect2.y > rect1.y + rect1.height ||
                 rect2.y + rect2.height < rect1.y);
    }

    // --- 10. MAIN GAME LOOP ---
    function mainGameLoop() {
        // Primary exit condition: only loop if playing or dying
        if (gameState !== 'PLAYING' && gameState !== 'DYING') {
            console.log(`Game loop stopping. State: ${gameState}`);
            // Check if game over needs to be handled *after* stopping
            if (gameState === 'GAMEOVER') {
                // Ensure handleGameOver runs if state was set elsewhere (e.g., during DYING check)
                 // but avoid calling it repeatedly if already handled.
                 // We might not need this call here if DYING handles it reliably.
                 // handleGameOver();
            }
            return;
        }

        // Handle DYING state and transition to GAMEOVER
        if (gameState === 'DYING') {
            speedMultiplier = Math.max(0.01, speedMultiplier * 0.98);
            if (speedMultiplier < 0.02) {
                 console.log("Dying sequence complete. Setting state to GAMEOVER.");
                 gameState = 'GAMEOVER';
                 handleGameOver(); // Trigger game over screen display
                 return; // Stop the loop now
            }
        } else {
            speedMultiplier = 1.0; // Ensure normal speed when PLAYING
        }

        // --- UPDATE ---
        updatePlayer(speedMultiplier);
        updateCycleAndFade(speedMultiplier);
        updateItems(speedMultiplier);
        updateEnemies(speedMultiplier);
        updateClouds(speedMultiplier);

        // --- DRAW ---
        draw();

        // --- CONTINUE LOOP ---
        // Request next frame ONLY if still playing or dying
        // This check prevents requesting frame when paused or menu
        if (gameState === 'PLAYING' || gameState === 'DYING') {
            animationFrameId = requestAnimationFrame(mainGameLoop);
        }
         // Removed the else if GAMEOVER here, handled by the DYING state transition
    }


    // --- 11. UPDATE SUB-FUNCTIONS ---
    function updatePlayer(speedMod) {
        // Skip update if player doesn't exist yet
        if (!player || player.y === undefined) return;

        player.velocityY += gravity * speedMod;
        player.y += player.velocityY * speedMod;
        if (player.velocityY < 0 && !isJumping) player.velocityY += 1.0;
        // Check groundLevel before using it
        if (groundLevel > 0 && player.y + player.height > groundLevel) {
            player.y = groundLevel - player.height;
            player.velocityY = 0;
            player.isOnGround = true;
        }
    }
    function updateCycleAndFade(speedMod) {
         // Skip update if scenery doesn't exist yet or groundLevel isn't set
        if (!scenery.sun || groundLevel <= 0) return;

        const transitionStartY = groundLevel - scenery.sun.height, transitionEndY = groundLevel, speed = SUN_MOON_SPEED * speedMod;
        switch (currentCycleState) {
            case 'DAY':
                scenery.sun.y += speed; scenery.moon.y = -200; nightOpacity = 0;
                if (scenery.sun.y >= transitionStartY) currentCycleState = 'SUNSET';
                break;
            case 'SUNSET':
                scenery.sun.y += speed;
                nightOpacity = Math.min(1, Math.max(0, (scenery.sun.y - transitionStartY) / scenery.sun.height));
                if (scenery.sun.y >= transitionEndY) { currentCycleState = 'NIGHT'; scenery.sun.y = -200; scenery.moon.y = 0 - scenery.moon.height; }
                break;
            case 'NIGHT':
                scenery.moon.y += speed; scenery.sun.y = -200; nightOpacity = 1;
                if (scenery.moon.y >= transitionStartY) currentCycleState = 'SUNRISE';
                break;
            case 'SUNRISE':
                scenery.moon.y += speed;
                nightOpacity = 1 - Math.min(1, Math.max(0, (scenery.moon.y - transitionStartY) / scenery.moon.height));
                if (scenery.moon.y >= transitionEndY) { currentCycleState = 'DAY'; scenery.moon.y = -200; scenery.sun.y = 0 - scenery.sun.height; }
                break;
        }
        dayOpacity = 1 - nightOpacity;
    }
    function updateClouds(speedMod) {
        // Skip update if scenery doesn't exist yet
        if (!scenery.clouds) return;
        scenery.clouds.forEach(cloud => {
            cloud.x -= CLOUD_SPEED * speedMod;
            if (cloud.x + cloud.width < 0) { cloud.x = canvas.width; cloud.y = Math.random() * (canvas.height * 0.4); }
        });
    }
    function updateItems(speedMod) {
        if (gameState === 'PLAYING') {
            timeToNextBanana--;
            if (timeToNextBanana <= 0) {
                spawnBanana();
                timeToNextBanana = 400 + (Math.random() * 100 - 50);
            }
        }
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            item.x -= ITEM_SPEED * speedMod;
            if (item.x + item.width < 0) {
                 items.splice(i, 1);
            } else if (checkCollision(player, item) && gameState === 'PLAYING') {
                items.splice(i, 1);
                score++;
            }
        }
    }
    function updateEnemies(speedMod) {
        if (gameState === 'PLAYING') {
            timeToNextEnemy--;
            if (timeToNextEnemy <= 0) {
                spawnEnemy();
                timeToNextEnemy = 300 + (Math.random() * 100 - 50);
            }
        }
        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            enemy.x -= ENEMY_SPEED * speedMod;
            if (enemy.x + enemy.width < 0) {
                 enemies.splice(i, 1);
            } else if (checkCollision(player, enemy) && gameState === 'PLAYING') {
                startGameOverSequence();
            }
        }
    }
    function spawnBanana() {
        const BANANA_WIDTH = 50, BANANA_HEIGHT = 50;
        // Ensure groundLevel is valid before spawning
        if (groundLevel <= 0 || player.height === undefined) return;
        const maxJumpPeak = (groundLevel - player.height) - (Math.pow(jumpPower, 2) / (2 * gravity));
        const lowZone_top = groundLevel - 150, lowZone_bottom = groundLevel - BANANA_HEIGHT - 20;
        const highZone_top = maxJumpPeak + 20, highZone_bottom = groundLevel - 250;
        let spawnY = 0;
        if (lowZone_top >= lowZone_bottom) return; // Avoid invalid range
        if (Math.random() < 0.5) {
             spawnY = Math.random() * (lowZone_bottom - lowZone_top) + lowZone_top;
        } else if (highZone_top < highZone_bottom) { // Check high zone validity
             spawnY = Math.random() * (highZone_bottom - highZone_top) + highZone_top;
        } else { // Fallback to low zone if high zone invalid
             spawnY = Math.random() * (lowZone_bottom - lowZone_top) + lowZone_top;
        }
        // Ensure spawnY is a valid number and below ground
        if (isNaN(spawnY) || spawnY > groundLevel - BANANA_HEIGHT) spawnY = lowZone_bottom - 10;
        if (spawnY < maxJumpPeak) spawnY = maxJumpPeak; // Prevent spawning too high

        items.push({ x: canvas.width, y: spawnY, width: BANANA_WIDTH, height: BANANA_HEIGHT, image: assets.banana });
    }
    function spawnEnemy() {
        const TIGER_WIDTH = 55, TIGER_HEIGHT = 55, HAWK_WIDTH = 50, HAWK_HEIGHT = 50;
        // Ensure groundLevel is valid before spawning
        if (groundLevel <= 0) return;
        let enemyType = (Math.random() < 0.5) ? 'tiger' : 'hawk';
        if (enemyType === 'tiger') {
            enemies.push({ x: canvas.width, y: groundLevel - TIGER_HEIGHT, width: TIGER_WIDTH, height: TIGER_HEIGHT, image: assets.tiger });
        } else {
            const minSpawnY = groundLevel - 200;
            const maxSpawnY = groundLevel - HAWK_HEIGHT - 100;
             // Ensure valid spawn range for hawk
             if(minSpawnY >= maxSpawnY) {
                 console.warn("Invalid hawk spawn range, defaulting Y.");
                 enemies.push({ x: canvas.width, y: groundLevel - 150, width: HAWK_WIDTH, height: HAWK_HEIGHT, image: assets.hawk });
             } else {
                 const spawnY = Math.random() * (maxSpawnY - minSpawnY) + minSpawnY;
                 enemies.push({ x: canvas.width, y: spawnY, width: HAWK_WIDTH, height: HAWK_HEIGHT, image: assets.hawk });
             }
        }
    }

    // --- 12. DRAW FUNCTION ---
    function draw() {
        // Ensure context is valid
        if (!ctx) {
             console.error("Canvas context not found during draw!");
             return;
        }
        // Ensure dimensions are valid
        if (canvas.width <= 0 || canvas.height <= 0) {
             console.warn(`Invalid canvas dimensions (${canvas.width}x${canvas.height}) during draw. Skipping frame.`);
             return;
        }


        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Backgrounds
        ctx.globalAlpha = 1; if (assets.bgClearSky) ctx.drawImage(assets.bgClearSky, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = nightOpacity; if (assets.bgStarryNight) ctx.drawImage(assets.bgStarryNight, 0, 0, canvas.width, canvas.height);
        // Sun & Moon (check if scenery exists)
        ctx.globalAlpha = 1;
        if (scenery.sun && assets.sun) ctx.drawImage(assets.sun, scenery.sun.x, scenery.sun.y, scenery.sun.width, scenery.sun.height);
        if (scenery.moon && assets.moon) ctx.drawImage(assets.moon, scenery.moon.x, scenery.moon.y, scenery.moon.width, scenery.moon.height);
        // Clouds (check if scenery exists)
        if (scenery.clouds) {
             scenery.clouds.forEach(cloud => {
                 if (assets.cloudDay) { ctx.globalAlpha = dayOpacity; ctx.drawImage(assets.cloudDay, cloud.x, cloud.y, cloud.width, cloud.height); }
                 if (assets.cloudNight) { ctx.globalAlpha = nightOpacity; ctx.drawImage(assets.cloudNight, cloud.x, cloud.y, cloud.width, cloud.height); }
             });
        }
        // Items (check if image exists on item)
        ctx.globalAlpha = 1; if (assets.banana) items.forEach(item => { if(item.image) ctx.drawImage(item.image, item.x, item.y, item.width, item.height); });
        // Enemies (check if image exists on enemy)
        ctx.globalAlpha = 1; enemies.forEach(enemy => { if(enemy.image) ctx.drawImage(enemy.image, enemy.x, enemy.y, enemy.width, enemy.height); });
        // Player (check if player and image exist)
        ctx.globalAlpha = 1; if (assets.playerImage && player && player.x !== undefined) ctx.drawImage(assets.playerImage, player.x, player.y, player.width, player.height);
        // Wasted Overlay
        if (gameState === 'DYING') { const overlayAlpha = 0.8 * (1 - speedMultiplier); ctx.globalAlpha = overlayAlpha; ctx.fillStyle = '#444'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1 - speedMultiplier; ctx.fillStyle = 'red'; ctx.font = '80px Arial'; ctx.textAlign = 'center'; ctx.fillText('WASTED', canvas.width / 2, canvas.height / 2); }
        // Score Display
        if (gameState === 'PLAYING') { ctx.globalAlpha = 1; ctx.fillStyle = 'yellow'; ctx.font = '30px Arial'; ctx.textAlign = 'right'; ctx.fillText('Bananas: ' + score, canvas.width - 20, 40); }
    }


    // --- 13. EVENT LISTENERS & INITIAL CALL ---
    grass.addEventListener('mousedown', () => { isJumping = true; jump(); });
    grass.addEventListener('touchstart', (e) => { e.preventDefault(); isJumping = true; jump(); });
    grass.addEventListener('mouseup', () => { isJumping = false; });
    grass.addEventListener('touchend', (e) => { e.preventDefault(); isJumping = false; });
    grass.addEventListener('mouseleave', () => { isJumping = false; });
    document.addEventListener('keydown', e => { if (e.code === 'Space') jump(); else if (e.code === 'KeyP') togglePause(); });
    window.addEventListener('resize', resizeCanvas);
    loadAllAssets(init); // Kick off the app
});