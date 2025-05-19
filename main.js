const startBtn = document.getElementById('start-btn');
const gameContainer = document.getElementById('game-container');
const mainMenu = document.getElementById('main-menu');
const gorilla = document.getElementById('gorilla');
const ground = document.getElementById('ground');
const pauseBtn = document.getElementById('pause-btn');
const pauseMenu = document.getElementById('pause-menu');
const continueBtn = document.getElementById('continue-btn');
const mainMenuBtn = document.getElementById('main-menu-btn');
const scoreScreen = document.getElementById('score-screen');
const topScoresList = document.getElementById('top-scores');
const restartBtn = document.getElementById('restart-btn');

let score = 0;
let topScores = JSON.parse(localStorage.getItem('topScores')) || [];
let isJumping = false;
let isPaused = false;
let gravity = 0.9;
let velocity = 0;
let jumpHeight = 18;
let enemies = [];
let bananas = [];
let gameInterval;

function startGame() {
    mainMenu.classList.add('hidden');
    pauseMenu.classList.add('hidden');
    scoreScreen.classList.add('hidden');
    gameContainer.classList.remove('hidden');
    gorilla.style.bottom = '50px';
    score = 0;
    isJumping = false;
    enemies = [];
    bananas = [];
    startLoop();
}

function pauseGame() {
    isPaused = true;
    clearInterval(gameInterval);
    pauseMenu.classList.remove('hidden');
}

function resumeGame() {
    isPaused = false;
    pauseMenu.classList.add('hidden');
    startLoop();
}

function endGame() {
    clearInterval(gameInterval);
    gameContainer.classList.add('hidden');
    scoreScreen.classList.remove('hidden');
    updateTopScores(score);
    renderTopScores();
}

function updateTopScores(newScore) {
    topScores.push(newScore);
    topScores.sort((a, b) => b - a);
    topScores = topScores.slice(0, 5);
    localStorage.setItem('topScores', JSON.stringify(topScores));
}

function renderTopScores() {
    topScoresList.innerHTML = '';
    topScores.forEach((s, i) => {
        const li = document.createElement('li');
        li.textContent = `#${i + 1}: ${s} 🍌`;
        topScoresList.appendChild(li);
    });
}

function jump() {
    if (isJumping) return;
    isJumping = true;
    velocity = jumpHeight;
}

function createEnemy(type) {
    const enemy = document.createElement('div');
    enemy.classList.add('enemy');
    enemy.textContent = type === 'hawk' ? '🦅' : '🐆';
    enemy.style.position = 'absolute';
    enemy.style.right = '0';
    enemy.style.fontSize = '2em';
    enemy.style.bottom = type === 'hawk' ? '150px' : '50px';
    gameContainer.appendChild(enemy);
    enemies.push(enemy);
}

function createBanana() {
    const banana = document.createElement('div');
    banana.classList.add('banana');
    banana.textContent = '🍌';
    banana.style.position = 'absolute';
    banana.style.right = '0';
    banana.style.bottom = `${Math.random() * 120 + 50}px`;
    banana.style.fontSize = '2em';
    gameContainer.appendChild(banana);
    bananas.push(banana);
}

function checkCollision(a, b) {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return !(
        ar.top > br.bottom ||
        ar.bottom < br.top ||
        ar.right < br.left ||
        ar.left > br.right
    );
}

function startLoop() {
    gameInterval = setInterval(() => {
        // Gorilla jump physics
        if (isJumping) {
            let bottom = parseInt(gorilla.style.bottom);
            bottom += velocity;
            velocity -= gravity;
            if (bottom <= 50) {
                bottom = 50;
                isJumping = false;
                velocity = 0;
            }
            gorilla.style.bottom = bottom + 'px';
        }

        // Move enemies
        enemies.forEach((enemy, i) => {
            enemy.style.right = parseInt(enemy.style.right) + 5 + 'px';
            if (checkCollision(gorilla, enemy)) {
                endGame();
            }
            if (parseInt(enemy.style.right) > window.innerWidth + 50) {
                enemy.remove();
                enemies.splice(i, 1);
            }
        });

        // Move bananas
        bananas.forEach((banana, i) => {
            banana.style.right = parseInt(banana.style.right) + 5 + 'px';
            if (checkCollision(gorilla, banana)) {
                score++;
                banana.remove();
                bananas.splice(i, 1);
            }
            if (parseInt(banana.style.right) > window.innerWidth + 50) {
                banana.remove();
                bananas.splice(i, 1);
            }
        });

        // Spawn random enemies or bananas
        if (Math.random() < 0.02) createEnemy(Math.random() < 0.5 ? 'hawk' : 'leopard');
        if (Math.random() < 0.01) createBanana();
    }, 30);
}

// 🌱 Jump button
ground.addEventListener('click', jump);
pauseBtn.addEventListener('click', pauseGame);
continueBtn.addEventListener('click', resumeGame);
mainMenuBtn.addEventListener('click', () => {
    pauseMenu.classList.add('hidden');
    mainMenu.classList.remove('hidden');
    gameContainer.classList.add('hidden');
});
restartBtn.addEventListener('click', startGame);
startBtn.addEventListener('click', startGame);

// Service Worker for offline
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}
