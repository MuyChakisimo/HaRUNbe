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
        { name: "playerImage", src: "Assets/Player/128x128DefaultGorilla.png" },
        { name: "bgClearSky", src: "Assets/Scenery/ClearSky.png" },
        { name: "bgStarryNight", src: "Assets/Scenery/StarryNight.png" },
        { name: "cloudDay", src: "Assets/Scenery/128x128DayCloud.png" },
        { name: "cloudNight", src: "Assets/Scenery/128x128NightCloud.png" },
        { name: "sun", src: "Assets/Scenery/128x128Sun.png" },
        { name: "moon", src: "Assets/Scenery/128x128Moon.png" },
        { name: "banana", src: "Assets/Items/128x128Banana.png" },
        { name: "tiger", src: "Assets/Enemies/128x128Tiger.png" },
        { name: "hawk", src: "Assets/Enemies/128x128Hawk.png" }
    ];
    let assetsLoaded = 0;

    function loadAllAssets(callback) {
        assetList.forEach(asset => {
            const img = new Image();
            img.src = asset.src;
            img.onload = () => {
                assets[asset.name] = img;
                assetsLoaded++;
                if (assetsLoaded === assetList.length) callback();
            };
            img.onerror = () => console.error("Error loading asset: " + asset.src);
        });
    }

    // --- 3. GAME STATE & VARIABLES ---
    let gameState = 'MENU'; // MENU, PLAYING, PAUSED, DYING, GAMEOVER
    let animationFrameId = null;
    let countdownIntervalId = null;
    let highScores = [];
    let paused = false;

    // Physics
    const gravity = 0.3;
    const jumpPower = -15;
    let grassHeight = 0;
    let groundLevel = 0;
    let isJumping = false;

    // World Speed
    const SUN_MOON_SPEED = 0.02;
    const CLOUD_SPEED = 0.05;
    const ITEM_SPEED = 0.8;
    const ENEMY_SPEED = 1.2;
    let speedMultiplier = 1.0;

    // Game Objects
    let player = {};
    let scenery = {};
    let items = [];
    let enemies = [];

    // Timers & Score
    let timeToNextBanana = 0;
    let timeToNextEnemy = 0;
    let score = 0;

    // Cycle
    let currentCycleState = 'DAY';
    let nightOpacity = 0;
    let dayOpacity = 1;

    // --- 4. CORE FUNCTIONS ---
    function resizeCanvas() {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        grassHeight = canvas.height * 0.20;
        groundLevel = canvas.height - grassHeight;

        if (player.y !== undefined) {
            if (player.y + player.height > groundLevel) {
                player.y = groundLevel - player.height;
                player.velocityY = 0;
                player.isOnGround = true;
            }
        }

        if (scenery.sun) {
            scenery.sun.x = (canvas.width / 2) - (scenery.sun.width / 2);
            scenery.moon.x = (canvas.width / 2) - (scenery.moon.width / 2);
        }
    }

    function jump() {
        if (gameState === 'PLAYING' && player.isOnGround) {
            player.velocityY = jumpPower;
            player.isOnGround = false;
        }
    }

    function init() {
        console.log("All assets loaded. Initializing listeners.");
        setupButtonListeners();
        loadHighScores();
        resizeCanvas();
    }

    function setupButtonListeners() {
        // Avoid adding multiple listeners
        buttons.start.addEventListener('click', startGame);
        buttons.viewScores.addEventListener('click', showHighScoreScreen);
        buttons.menuFromScores.addEventListener('click', () => showScreen('mainMenu'));
        buttons.restart.addEventListener('click', startGame);
        buttons.menuFromGameOver.addEventListener('click', () => showScreen('mainMenu'));
        buttons.pause.addEventListener('click', togglePause);
        buttons.resume.addEventListener('click', resumeGame);
        buttons.returnTitle.addEventListener('click', returnToTitle);
        buttons.submitScore.addEventListener('click', submitHighScore);
    }

    function showScreen(screenId) {
        for (let key in screens) screens[key].classList.remove('active');
        screens[screenId].classList.add('active');
    }

    // --- 5. GAME START & RESET ---
    function startGame() {
        // Clean any previous countdowns or pause states
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
        paused = false;
        pauseOverlay.style.display = 'none';

        resizeCanvas();
        resetGame();
        gameState = 'PLAYING';
        showScreen('game');
        mainGameLoop();
    }

    function resetGame() {
        isJumping = false;
        speedMultiplier = 1.0;
        score = 0;
        items = [];
        enemies = [];

        player = { x: 150, y: 0, width: 60, height: 60, velocityY: 0, isOnGround: true };
        scenery = { sun: { x: 0, y: -200, width: 100, height: 100 }, moon: { x: 0, y: -200, width: 100, height: 100 }, clouds: [] };
        timeToNextBanana = 100;
        timeToNextEnemy = 200;

        currentCycleState = 'DAY';
        nightOpacity = 0;
        dayOpacity = 1;

        for (let i = 0; i < 3; i++) {
            scenery.clouds.push({ x: Math.random() * canvas.width, y: Math.random() * (canvas.height * 0.4), width: 128, height: 70 });
        }
    }

    // --- 6. HIGH SCORE LOGIC ---
    function loadHighScores() {
        const scores = localStorage.getItem('haRUNbeHighScores');
        highScores = scores ? JSON.parse(scores) : [];
        updateHighScoreDisplay();
    }

    function saveHighScores() {
        localStorage.setItem('haRUNbeHighScores', JSON.stringify(highScores));
    }

    function updateHighScoreDisplay() {
        scoreList.innerHTML = '';
        if (!highScores.length) scoreList.innerHTML = '<li>No scores yet!</li>';
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
        highScores.push({ name, score });
        highScores.sort((a, b) => b.score - a.score);
        highScores = highScores.slice(0, 5);
        saveHighScores();
        nameInput.value = '';
        showHighScoreScreen();
    }

    // --- 7. PAUSE & RESUME ---
    function togglePause() {
        if (gameState === 'PLAYING') pauseGame();
        else if (gameState === 'PAUSED') resumeGame();
    }

    function pauseGame() {
        if (gameState !== 'PLAYING') return;
        paused = true;
        gameState = 'PAUSED';
        overlayText.textContent = 'PAUSED';
        pauseOverlay.style.display = 'flex';
    }

    function resumeGame() {
        if (gameState !== 'PAUSED') return;

        clearInterval(countdownIntervalId);
        countdownIntervalId = null;

        let count = 3;
        overlayText.textContent = count;
        countdownIntervalId = setInterval(() => {
            count--;
            if (count > 0) overlayText.textContent = count;
            else {
                clearInterval(countdownIntervalId);
                countdownIntervalId = null;
                paused = false;
                gameState = 'PLAYING';
                pauseOverlay.style.display = 'none';
            }
        }, 1000);
    }

    function returnToTitle() {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
        paused = false;
        gameState = 'MENU';
        pauseOverlay.style.display = 'none';
        cancelAnimationFrame(animationFrameId);
        showScreen('mainMenu');
    }

    // --- 8. GAME OVER LOGIC ---
    function startGameOverSequence() {
        gameState = 'DYING';
        isJumping = false;
    }

    function handleGameOver() {
        gameState = 'GAMEOVER';
        cancelAnimationFrame(animationFrameId);
        if (isNewHighScore()) {
            finalScoreInputDisplay.textContent = Math.floor(score);
            showScreen('enterScore');
        } else {
            finalScoreDisplay.textContent = Math.floor(score);
            showScreen('finalScore');
        }
    }

    // --- 9. MAIN GAME LOOP ---
    function mainGameLoop() {
        animationFrameId = requestAnimationFrame(mainGameLoop);

        if (paused || gameState === 'MENU') return;

        if (gameState === 'DYING') {
            speedMultiplier = Math.max(0.01, speedMultiplier * 0.98);
            if (speedMultiplier < 0.02) gameState = 'GAMEOVER';
        }

        updatePlayer();
        updateCycleAndFade();
        updateItems();
        updateEnemies();
        updateClouds();
        draw();

        if (gameState === 'GAMEOVER') handleGameOver();
    }

    // --- 10. UPDATE FUNCTIONS ---
    function updatePlayer() {
        player.velocityY += gravity;
        player.y += player.velocityY;
        if (player.y + player.height > groundLevel) {
            player.y = groundLevel - player.height;
            player.velocityY = 0;
            player.isOnGround = true;
        }
    }

    function updateCycleAndFade() {
        const transitionStartY = groundLevel - scenery.sun.height;
        const transitionEndY = groundLevel;
        let speed = SUN_MOON_SPEED;
        switch (currentCycleState) {
            case 'DAY':
                scenery.sun.y += speed; scenery.moon.y = -200; nightOpacity = 0;
                if (scenery.sun.y >= transitionStartY) currentCycleState = 'SUNSET';
                break;
            case 'SUNSET':
                scenery.sun.y += speed;
                nightOpacity = Math.min(1, (scenery.sun.y - transitionStartY) / scenery.sun.height);
                if (scenery.sun.y >= transitionEndY) {
                    currentCycleState = 'NIGHT'; scenery.sun.y = -200; scenery.moon.y = 0 - scenery.moon.height;
                }
                break;
            case 'NIGHT':
                scenery.moon.y += speed; scenery.sun.y = -200; nightOpacity = 1;
                if (scenery.moon.y >= transitionStartY) currentCycleState = 'SUNRISE';
                break;
            case 'SUNRISE':
                scenery.moon.y += speed;
                nightOpacity = Math.max(0, 1 - (scenery.moon.y / transitionStartY));
                if (scenery.moon.y >= transitionEndY) currentCycleState = 'DAY';
                break;
        }
    }

    function updateClouds() {
        scenery.clouds.forEach(c => {
            c.x -= CLOUD_SPEED * speedMultiplier * 60 / 16;
            if (c.x + c.width < 0) c.x = canvas.width;
        });
    }

    function updateItems() {
        timeToNextBanana--;
        if (timeToNextBanana <= 0) {
            items.push({ x: canvas.width, y: Math.random() * (groundLevel - 50), width: 50, height: 50, image: assets.banana });
            timeToNextBanana = 100;
        }
        items.forEach((item, i) => {
            item.x -= ITEM_SPEED * speedMultiplier * 60 / 16;
            if (checkCollision(player, item)) {
                score += 10;
                items.splice(i, 1);
            } else if (item.x + item.width < 0) items.splice(i, 1);
        });
    }

    function updateEnemies() {
        timeToNextEnemy--;
        if (timeToNextEnemy <= 0) {
            enemies.push({ x: canvas.width, y: groundLevel - 50, width: 50, height: 50, image: assets.tiger });
            timeToNextEnemy = 200;
        }
        enemies.forEach((enemy, i) => {
            enemy.x -= ENEMY_SPEED * speedMultiplier * 60 / 16;
            if (checkCollision(player, enemy)) {
                startGameOverSequence();
            } else if (enemy.x + enemy.width < 0) enemies.splice(i, 1);
        });
    }

    // --- 11. DRAWING ---
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Sky fade
        ctx.fillStyle = `rgba(0,0,0,${nightOpacity})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Clouds
        scenery.clouds.forEach(c => ctx.drawImage(assets.cloudDay, c.x, c.y, c.width, c.height));

        // Sun & Moon
        ctx.drawImage(assets.sun, scenery.sun.x, scenery.sun.y, scenery.sun.width, scenery.sun.height);
        ctx.drawImage(assets.moon, scenery.moon.x, scenery.moon.y, scenery.moon.width, scenery.moon.height);

        // Player
        ctx.drawImage(assets.playerImage, player.x, player.y, player.width, player.height);

        // Items
        items.forEach(item => ctx.drawImage(item.image, item.x, item.y, item.width, item.height));

        // Enemies
        enemies.forEach(enemy => ctx.drawImage(enemy.image, enemy.x, enemy.y, enemy.width, enemy.height));

        // Grass
        ctx.fillStyle = "#228B22";
        ctx.fillRect(0, groundLevel, canvas.width, grassHeight);

        // Score
        ctx.fillStyle = "white";
        ctx.font = "30px Arial";
        ctx.fillText(`Score: ${Math.floor(score)}`, 20, 40);
    }

    // --- 12. COLLISION ---
    function checkCollision(rect1, rect2) {
        return rect1.x < rect2.x + rect2.width &&
               rect1.x + rect1.width > rect2.x &&
               rect1.y < rect2.y + rect2.height &&
               rect1.y + rect1.height > rect2.y;
    }

    // --- 13. INPUT HANDLING ---
    document.addEventListener('keydown', e => { if (e.code === 'Space') jump(); });
    canvas.addEventListener('click', jump);
    grass.addEventListener('click', jump);

    // --- 14. RESIZE ---
    window.addEventListener('resize', resizeCanvas);

    // --- 15. LOAD ASSETS & START ---
    loadAllAssets(init);

});
