import { generateQuestions, getVideoInfo, saveQuestions, loadQuestions, configureAPIKeys, areAPIKeysConfigured } from './questionGenerator.js';

// --- Elementos del DOM ---
const setupSection = document.getElementById('setup-section');
const mainContent = document.getElementById('main-content');
const setupForm = document.getElementById('setup-form');
const videoUrlInput = document.getElementById('video-url');
const apiKeyInput = document.getElementById('api-key');
const changeVideoButton = document.getElementById('change-video');
const videoWrapper = document.getElementById('youtube-player');
const questionOverlay = document.getElementById('question-overlay');
const questionText = document.getElementById('question-text');
const answersContainer = document.getElementById('answers-container');
const feedback = document.getElementById('feedback');
const submitButton = document.getElementById('submit-answer');
const resetButton = document.getElementById('reset-progress');
const progressBar = document.getElementById('progress-bar');
const progressTextSrOnly = document.getElementById('progress-text'); // Para lectores de pantalla
const reviewSection = document.getElementById('review-section');
const reviewContent = document.getElementById('review-content');
const restartVideoButton = document.getElementById('restart-video');
const videoTitleInput = document.getElementById('video-title');

// --- Variables Globales ---
let player = null; // Instancia del reproductor de YouTube
let questions = []; // Almacena las preguntas cargadas
let currentQuestionIndex = 0; // Índice de la pregunta actual
let userAnswers = []; // Almacena las respuestas del usuario para revisión
let currentQuestionData = null; // Almacena la pregunta actual en display
let isQuestionActive = false; // Bandera para saber si una pregunta está siendo mostrada
let currentLocale = {}; // Para las cadenas de texto (i18n)
let score = 0;
let hintsUsed = 0;
let questionTimer = null;
let timeRemaining = 0;
let currentLevel = 1;
let practiceMode = false;
let currentVideoId = null;
let currentVideoTitle = '';

const LOCAL_STORAGE_KEY_PROGRESS = 'videoInteractiveProgress';
const LOCAL_STORAGE_KEY_ANSWERS = 'videoInteractiveAnswers';
const LOCAL_STORAGE_KEY_SCORE = 'videoInteractiveScore';
const QUESTION_TIME_LIMIT = 30; // segundos por pregunta
const HINTS_PER_QUESTION = 2;

// URL de tu webhook de Make.com (pon aquí la tuya real)
const MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/193grhpf26x3nrcpxbw5hvsn1ih9sp27';

// --- Funciones de Utilidad ---

/**
 * Aleatoriza un array usando el algoritmo de Fisher-Yates.
 * @param {Array} array El array a aleatorizar.
 * @returns {Array} El array aleatorizado.
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Carga las cadenas de texto para internacionalización.
 * @param {string} lang El código del idioma (ej. 'es').
 */
async function loadLocale(lang = 'es') {
    try {
        const response = await fetch(`./locales/${lang}.json`);
        currentLocale = await response.json();
        applyLocalization();
    } catch (error) {
        console.error('Error al cargar el archivo de idioma:', error);
        // Fallback a un objeto vacío o valores por defecto
        currentLocale = {};
    }
}

/**
 * Aplica las cadenas de texto del idioma actual a los elementos del DOM.
 */
function applyLocalization() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.dataset.i18n;
        if (currentLocale[key]) {
            element.textContent = currentLocale[key];
        }
    });
    // Actualizar texto del progreso para lectores de pantalla
    updateProgressBar(currentQuestionIndex);
}

/**
 * Obtiene una cadena de texto localizada.
 * @param {string} key La clave de la cadena.
 * @param {object} [replacements] Objeto con reemplazos para el texto.
 * @returns {string} La cadena de texto localizada o la clave si no se encuentra.
 */
function getLocalizedText(key, replacements = {}) {
    let text = currentLocale[key] || key;
    for (const placeholder in replacements) {
        text = text.replace(`{${placeholder}}`, replacements[placeholder]);
    }
    return text;
}

// --- Funciones de la API de YouTube ---

/**
 * Esta función se llama automáticamente cuando la API de YouTube IFrame está lista.
 */
function onYouTubeIframeAPIReady() {
    console.log('API de YouTube lista');
    // El reproductor se inicializará cuando se configure el video
}

/**
 * Se ejecuta cuando el reproductor de YouTube está listo.
 */
function onPlayerReady(event) {
    console.log('Reproductor de YouTube listo.');
    loadProgress();
    
    const videoData = player.getVideoData();
    const videoId = videoData.video_id;

    // Si aún no tenemos título, intentar obtenerlo del iframe como respaldo
    if (!currentVideoTitle) {
        const iframe = document.querySelector('#youtube-player iframe');
        if (iframe) {
            currentVideoTitle = iframe.title || 'Título no disponible';
        }
    }

    console.log('Datos del video:', {
        videoData,
        title: currentVideoTitle,
        id: videoId
    });
    
    if (!videoId) {
        console.error('Error: No se pudo obtener el ID del video');
        alert('Error al obtener información del video. Por favor, intente nuevamente.');
        return;
    }

    console.log('Enviando a Make.com:', { videoId, videoTitle: currentVideoTitle });
    getQuestionsFromMake(videoId, currentVideoTitle)
        .then(questionsData => {
            console.log('Respuesta de Make.com recibida:', questionsData);
            setupInteractiveQuestions(videoId, questionsData);
            if (player.getPlayerState() === YT.PlayerState.PLAYING) {
                checkQuestionTiming();
            } else {
                player.pauseVideo();
            }
        })
        .catch(error => {
            console.error('Error getting questions from Make:', error);
            alert('Error al obtener preguntas del servidor: ' + error.message);
        });
}

/**
 * Se ejecuta cuando el estado del reproductor de YouTube cambia.
 * @param {object} event El evento de cambio de estado.
 */
function onPlayerStateChange(event) {
    // Si el video está reproduciéndose, verificar si es hora de una pregunta
    if (event.data === YT.PlayerState.PLAYING) {
        checkQuestionTiming();
    }
    // Si el video ha terminado, mostrar la sección de revisión
    if (event.data === YT.PlayerState.ENDED) {
        showReviewSection();
    }
}

/**
 * Comprueba si es el momento de una pregunta y la muestra.
 */
let questionCheckInterval;
function checkQuestionTiming() {
    // Si ya hay una pregunta activa, no hacer nada
    if (isQuestionActive) return;

    // Detener el intervalo si ya existe para evitar duplicados
    if (questionCheckInterval) {
        clearInterval(questionCheckInterval);
    }

    questionCheckInterval = setInterval(() => {
        if (player && player.getCurrentTime) {
            const currentTime = player.getCurrentTime();
            const nextQuestion = questions[currentQuestionIndex];

            if (nextQuestion && currentTime >= nextQuestion.time && !isQuestionActive) {
                player.pauseVideo(); // Pausar el video
                isQuestionActive = true; // Establecer la bandera
                displayQuestion(nextQuestion); // Mostrar la pregunta
                clearInterval(questionCheckInterval); // Detener el intervalo hasta que la pregunta sea respondida
            }
        }
    }, 500); // Verificar cada 500ms
}

// --- Funciones de Preguntas y Respuestas ---

/**
 * Muestra una pregunta en la interfaz.
 * @param {object} question La pregunta a mostrar.
 */
function displayQuestion(question) {
    currentQuestionData = question;
    questionText.textContent = question.question;
    answersContainer.innerHTML = '';
    feedback.textContent = '';
    hintsUsed = 0;
    
    // Mostrar elementos de UI adicionales
    document.getElementById('hint-text').style.display = 'none';
    document.getElementById('question-timer').style.display = 'block';
    
    // Iniciar temporizador si no estamos en modo práctica
    if (!practiceMode) {
        startQuestionTimer();
    }

    let answers = [...question.answers]; // Copia para no modificar el original

    if (question.randomize) {
        answers = shuffleArray(answers);
    }

    answers.forEach((answer, index) => {
        const button = document.createElement('button');
        button.textContent = answer.text;
        button.dataset.index = index; // Usar el índice original para verificar
        button.classList.add('btn'); // Añadir clase base de botón
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', 'false');
        button.setAttribute('tabindex', '0'); // Hacer botones enfocables
        button.addEventListener('click', selectAnswer);
        answersContainer.appendChild(button);
    });

    questionOverlay.style.display = 'flex';
    submitButton.focus(); // Poner el foco en el botón de enviar para accesibilidad
}

/**
 * Maneja la selección de una respuesta.
 * @param {Event} event El evento de clic.
 */
function selectAnswer(event) {
    const selectedButton = event.target;

    // Quitar la clase 'selected' de todos los botones y resetear aria-checked
    answersContainer.querySelectorAll('button').forEach(btn => {
        btn.classList.remove('selected');
        btn.setAttribute('aria-checked', 'false');
    });

    // Añadir la clase 'selected' al botón actual y establecer aria-checked
    selectedButton.classList.add('selected');
    selectedButton.setAttribute('aria-checked', 'true');
    feedback.textContent = ''; // Limpiar feedback anterior al seleccionar nueva respuesta
}

/**
 * Verifica la respuesta seleccionada por el usuario.
 */
function checkAnswer() {
    console.log('checkAnswer ejecutada'); // Log para depuración
    const selectedButton = answersContainer.querySelector('button.selected');

    if (!selectedButton) {
        feedback.textContent = getLocalizedText('select_answer_prompt');
        feedback.style.color = getComputedStyle(document.documentElement).getPropertyValue('--danger-color') || '#dc3545';
        return;
    }

    const selectedIndex = parseInt(selectedButton.dataset.index);
    const isCorrect = currentQuestionData.answers[selectedIndex].correct;

    // Guardar la respuesta del usuario para el modo revisión
    userAnswers.push({
        question: currentQuestionData.question,
        userAnswer: currentQuestionData.answers[selectedIndex].text,
        correctAnswer: currentQuestionData.answers.find(a => a.correct).text,
        isCorrect: isCorrect
    });
    saveProgress();

    if (isCorrect) {
        feedback.textContent = getLocalizedText('correct_feedback');
        feedback.style.color = getComputedStyle(document.documentElement).getPropertyValue('--success-color') || '#28a745';
        selectedButton.classList.add('correct');
        submitButton.style.display = 'none';
        resetButton.style.display = 'none';

        setTimeout(() => {
            questionOverlay.style.display = 'none';
            isQuestionActive = false;
            currentQuestionIndex++;
            updateProgressBar(currentQuestionIndex);

            if (currentQuestionIndex < questions.length) {
                player.playVideo();
                checkQuestionTiming();
            } else {
                showReviewSection();
            }
        }, 1500);
    } else {
        feedback.textContent = getLocalizedText('incorrect_feedback');
        feedback.style.color = getComputedStyle(document.documentElement).getPropertyValue('--danger-color') || '#dc3545';
        selectedButton.classList.add('incorrect');
    }
}

// --- Funciones de Progreso y Persistencia ---

/**
 * Actualiza la barra de progreso visualmente y para lectores de pantalla.
 * @param {number} currentProgressIndex El índice de la pregunta actual (0-based).
 */
function updateProgressBar(currentProgressIndex) {
    if (questions.length === 0) {
        progressBar.style.width = '0%';
        progressTextSrOnly.textContent = getLocalizedText('progress_text_sr_only', {progress: 0});
        return;
    }
    const progress = (currentProgressIndex / questions.length) * 100;
    progressBar.style.width = `${progress}%`;
    progressTextSrOnly.textContent = getLocalizedText('progress_text_sr_only', {progress: Math.round(progress)});
}

/**
 * Guarda el progreso actual y las respuestas del usuario en localStorage.
 */
function saveProgress() {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY_PROGRESS, currentQuestionIndex.toString());
        localStorage.setItem(LOCAL_STORAGE_KEY_ANSWERS, JSON.stringify(userAnswers));
        console.log('Progreso y respuestas guardados.');
    } catch (e) {
        console.error('Error al guardar en localStorage:', e);
    }
}

/**
 * Carga el progreso y las respuestas del usuario desde localStorage.
 */
function loadProgress() {
    try {
        const savedIndex = localStorage.getItem(LOCAL_STORAGE_KEY_PROGRESS);
        const savedAnswers = localStorage.getItem(LOCAL_STORAGE_KEY_ANSWERS);

        if (savedIndex) {
            currentQuestionIndex = parseInt(savedIndex, 10);
            updateProgressBar(currentQuestionIndex);
            console.log(`Progreso cargado: ${currentQuestionIndex} preguntas completadas.`);
        }
        if (savedAnswers) {
            userAnswers = JSON.parse(savedAnswers);
            console.log('Respuestas cargadas:', userAnswers);
        }

        // Si ya ha completado todas las preguntas, ir directamente al modo revisión
        if (currentQuestionIndex >= questions.length && questions.length > 0) {
            showReviewSection();
        } else {
            // Si hay progreso, ir al punto del video
            if (currentQuestionIndex > 0) {
                // Calcular el tiempo de la última pregunta respondida para reanudar desde ahí
                const lastQuestionTime = questions[currentQuestionIndex - 1]?.time || 0;
                player.seekTo(lastQuestionTime, true);
            }
            player.playVideo(); // Intentar reproducir para que onStateChange lo maneje
            player.pauseVideo(); // Pausar para que el usuario inicie manualmente o espere la siguiente pregunta
        }

    } catch (e) {
        console.warn('No se pudo cargar el progreso desde localStorage o datos corruptos.', e);
        resetProgress(); // Resetear si hay un error al cargar
    }
}

/**
 * Reinicia todo el progreso del usuario.
 */
function resetProgress() {
    console.log('resetProgress ejecutada'); // Log para depuración
    localStorage.removeItem(LOCAL_STORAGE_KEY_PROGRESS);
    localStorage.removeItem(LOCAL_STORAGE_KEY_ANSWERS);
    currentQuestionIndex = 0;
    userAnswers = [];
    updateProgressBar(0);
    player.seekTo(0, true); // Ir al inicio del video
    player.playVideo();
    questionOverlay.style.display = 'none';
    reviewSection.style.display = 'none';
    isQuestionActive = false;
    checkQuestionTiming(); // Reanudar la verificación de tiempos
    console.log('Progreso reiniciado.');
}


// --- Modo de Revisión ---

/**
 * Muestra la sección de revisión con las respuestas del usuario.
 */
function showReviewSection() {
    questionOverlay.style.display = 'none'; // Asegurarse de que el overlay de preguntas esté oculto
    reviewSection.style.display = 'block';
    player.pauseVideo(); // Asegurarse de que el video esté pausado

    reviewContent.innerHTML = ''; // Limpiar contenido anterior

    if (userAnswers.length === 0) {
        reviewContent.innerHTML = `<p>${getLocalizedText('no_answers_yet', {count: questions.length})}</p>`;
        return;
    }

    userAnswers.forEach((item, index) => {
        const reviewItem = document.createElement('div');
        reviewItem.classList.add('review-item');
        if (item.isCorrect) {
            reviewItem.classList.add('correct');
        } else {
            reviewItem.classList.add('incorrect');
        }

        reviewItem.innerHTML = `
            <p class="question-text"><strong>${getLocalizedText('question_number', {number: index + 1})}:</strong> ${item.question}</p>
            <p class="user-answer"><strong>${getLocalizedText('review_your_answer')}:</strong> ${item.userAnswer}</p>
            <p class="correct-answer"><strong>${getLocalizedText('review_correct_answer')}:</strong> ${item.correctAnswer}</p>
            <p class="feedback-text">${item.isCorrect ? getLocalizedText('review_result_correct') : getLocalizedText('review_result_incorrect')}</p>
        `;
        reviewContent.appendChild(reviewItem);
    });

    // Asegurarse de que el botón de reiniciar progreso esté visible en la revisión si el usuario quiere reiniciar
    resetButton.style.display = 'block';
}

// --- Funciones de Configuración ---

/**
 * Extrae el ID del video de una URL de YouTube
 * @param {string} url - URL del video de YouTube
 * @returns {string|null} - ID del video o null si no es válido
 */
function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    const videoId = (match && match[2].length === 11) ? match[2] : null;
    
    if (videoId) {
        // Intentar obtener el título de la URL
        try {
            const urlObj = new URL(url);
            const titleParam = urlObj.searchParams.get('title');
            if (titleParam) {
                currentVideoTitle = decodeURIComponent(titleParam);
            } else {
                // Si no hay título en los parámetros, intentar obtenerlo del texto después del ID
                const urlParts = url.split(videoId);
                if (urlParts.length > 1) {
                    const afterId = urlParts[1];
                    const titleMatch = afterId.match(/[?&]title=([^&]+)/);
                    if (titleMatch) {
                        currentVideoTitle = decodeURIComponent(titleMatch[1]);
                    }
                }
            }
        } catch (error) {
            console.error('Error al extraer título de la URL:', error);
        }
    }
    
    return (match && match[2].length === 11) ? match[2] : null;
}

/**
 * Maneja los errores de la API de YouTube
 * @param {Error} error - El error ocurrido
 */
function handleYouTubeError(error) {
    console.error('Error en la API de YouTube:', error);
    
    // Mostrar mensaje de error específico
    let errorMessage = 'Error al cargar el video. ';
    
    if (error.data) {
        switch (error.data) {
            case 2:
                errorMessage += 'ID de video inválido.';
                break;
            case 5:
                errorMessage += 'Error en el reproductor de HTML5.';
                break;
            case 100:
                errorMessage += 'El video solicitado no existe o ha sido eliminado.';
                break;
            case 101:
            case 150:
                errorMessage += 'El propietario del video no permite su reproducción en sitios web externos.';
                break;
            default:
                errorMessage += 'Por favor, verifica que la URL sea correcta y que el video esté disponible.';
        }
    }
    
    alert(errorMessage);
    mainContent.style.display = 'none';
    setupSection.style.display = 'block';
}

/**
 * Solicita las preguntas y tiempos a Make.com
 * @param {string} videoId - ID del video de YouTube
 * @param {string} videoTitle - Título del video de YouTube
 * @param {string|null} manualTranscription - Transcripción manual si se proporcionó
 * @returns {Promise<Object>} - JSON con preguntas y tiempos
 */
async function getQuestionsFromMake(videoId, videoTitle, manualTranscription = null) {
    // Validación de datos
    if (!videoId) {
        throw new Error('ID del video no proporcionado');
    }

    const payload = { 
        videoId: videoId,
        videoTitle: videoTitle || 'Título no disponible'
    };

    if (manualTranscription) {
        payload.transcription = manualTranscription;
    }

    console.log('Enviando payload a Make.com:', payload);

    try {
        const response = await fetch(MAKE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error response from Make.com:', errorText);
            throw new Error(`Error del servidor: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Respuesta completa de Make.com:', data);

        // Validar la estructura de las preguntas
        if (!data.questions || !Array.isArray(data.questions)) {
            throw new Error('Formato de respuesta inválido: no se encontraron preguntas');
        }

        // Validar cada pregunta
        data.questions = data.questions.map((q, index) => {
            if (!q.question || !q.time || !Array.isArray(q.answers)) {
                throw new Error(`Formato inválido en la pregunta ${index + 1}`);
            }
            
            // Asegurar que cada respuesta tenga el formato correcto
            q.answers = q.answers.map((a, aIndex) => {
                if (!a.text || typeof a.correct !== 'boolean') {
                    throw new Error(`Formato inválido en la respuesta ${aIndex + 1} de la pregunta ${index + 1}`);
                }
                return a;
            });

            // Asegurar que haya exactamente una respuesta correcta
            const correctAnswers = q.answers.filter(a => a.correct);
            if (correctAnswers.length !== 1) {
                throw new Error(`La pregunta ${index + 1} debe tener exactamente una respuesta correcta`);
            }

            return q;
        });

        return data;
    } catch (error) {
        console.error('Error en getQuestionsFromMake:', error);
        throw error;
    }
}

/**
 * Configura un nuevo video usando preguntas y tiempos recibidos
 * @param {string} videoId - ID del video de YouTube
 * @param {Object} questionsData - JSON con preguntas y tiempos
 */
function setupVideoWithQuestions(videoId, questionsData) {
    // Guardar preguntas en localStorage
    saveQuestions(videoId, questionsData);
    // Actualizar el estado de la aplicación
    questions = questionsData.questions;
    currentVideoId = videoId;
    currentQuestionIndex = 0;
    userAnswers = [];
    score = 0;
    // Mostrar el contenido principal
    setupSection.style.display = 'none';
    mainContent.style.display = 'block';
    // Inicializar el reproductor
    if (player) {
        player.destroy();
    }
    // Crear el contenedor del video si no existe
    const playerContainer = document.getElementById('youtube-player');
    if (!playerContainer) {
        const container = document.createElement('div');
        container.id = 'youtube-player';
        document.getElementById('video-container').appendChild(container);
    }
    // Esperar a que la API de YouTube esté lista
    if (typeof YT === 'undefined' || !YT.Player) {
        window.onYouTubeIframeAPIReady = () => {
            console.log('API de YouTube lista');
            initializePlayer(videoId);
        };
    } else {
        initializePlayer(videoId);
    }
    // Actualizar la UI
    updateProgressBar(0);
    updateScoreDisplay();
}

function initializePlayer(videoId) {
    player = new YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            'playsinline': 1,
            'controls': 1,
            'rel': 0,
            'modestbranding': 1,
            'origin': window.location.origin,
            'host': 'https://www.youtube-nocookie.com',
            'enablejsapi': 1,
            'title': 1 // Asegurar que el título esté habilitado
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onError': handleYouTubeError
        }
    });
}

// --- Event Listeners ---

setupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const videoUrl = videoUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const transcriptionText = document.getElementById('transcription').value.trim();
    const videoTitle = videoTitleInput.value.trim();

    const videoId = extractVideoId(videoUrl);

    if (!videoId) {
        alert('Por favor, introduce una URL válida de YouTube.');
        return;
    }

    if (!videoTitle) {
        alert('Por favor, introduce el título del video.');
        return;
    }
    
    // Guardar el título
    currentVideoTitle = videoTitle;
    
    configureAPIKeys(apiKey, '');

    try {
        setupVideoPlayer(videoId);
        
        let questionsData = null;
        if (transcriptionText) {
            alert('La generación de preguntas local con transcripción manual aún no está implementada.');
            questionsData = await getQuestionsFromMake(videoId, currentVideoTitle, transcriptionText);
        } else {
            questionsData = await getQuestionsFromMake(videoId, currentVideoTitle);
        }

        setupInteractiveQuestions(videoId, questionsData);

    } catch (error) {
        alert('Error al configurar el video: ' + error.message);
        console.error('Setup Error:', error);
    }
});

changeVideoButton.addEventListener('click', () => {
    mainContent.style.display = 'none';
    setupSection.style.display = 'block';
    videoUrlInput.value = '';
    videoTitleInput.value = ''; // Limpiar también el título
});

// --- Inicialización ---

document.addEventListener('DOMContentLoaded', async function() {
    await loadLocale();
    updateProgressBar(currentQuestionIndex);

    // Asignar eventos
    setupForm.addEventListener('submit', handleSetupSubmit);
    submitButton.addEventListener('click', checkAnswer);
    resetButton.addEventListener('click', resetProgress);
    restartVideoButton.addEventListener('click', resetProgress);
});

/**
 * Inicializa el reproductor de YouTube con un video específico.
 * Separamos la inicialización del reproductor de la configuración de preguntas.
 * @param {string} videoId - ID del video de YouTube
 */
function setupVideoPlayer(videoId) {
    // Mostrar el contenido principal
    setupSection.style.display = 'none';
    mainContent.style.display = 'block';

    // Inicializar el reproductor
    if (player) {
        player.destroy();
    }
    // Crear el contenedor del video si no existe
    const playerContainer = document.getElementById('youtube-player');
    if (!playerContainer) {
        const container = document.createElement('div');
        container.id = 'youtube-player';
        document.getElementById('video-container').appendChild(container);
    }
    // Esperar a que la API de YouTube esté lista
    if (typeof YT === 'undefined' || !YT.Player) {
        window.onYouTubeIframeAPIReady = () => {
            console.log('API de YouTube lista');
            initializePlayer(videoId);
        };
    } else {
        initializePlayer(videoId);
    }
     currentVideoId = videoId; // Guardar el ID del video actual
}

/**
 * Configura la interactividad con preguntas una vez que el reproductor está listo
 * y las preguntas han sido cargadas/generadas.
 * @param {string} videoId - ID del video de YouTube
 * @param {Object} questionsData - JSON con preguntas y tiempos
 */
function setupInteractiveQuestions(videoId, questionsData) {
     // Guardar preguntas en localStorage
     saveQuestions(videoId, questionsData);
     // Actualizar el estado de la aplicación
     questions = questionsData.questions;
     currentQuestionIndex = 0;
     userAnswers = [];
     score = 0;
     // Actualizar la UI
     updateProgressBar(0);
     updateScoreDisplay();
     // Cargar progreso guardado (si existe) para este video
     loadProgress();
     // Iniciar la verificación de preguntas (esto se activa en onPlayerReady/onStateChange)
     checkQuestionTiming();
}

/**
 * Inicia el temporizador para la pregunta actual
 */
function startQuestionTimer() {
    timeRemaining = QUESTION_TIME_LIMIT;
    if (questionTimer) clearInterval(questionTimer);
    
    questionTimer = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();
        
        if (timeRemaining <= 0) {
            clearInterval(questionTimer);
            handleTimeUp();
        }
    }, 1000);
}

/**
 * Actualiza la visualización del temporizador
 */
function updateTimerDisplay() {
    const timerElement = document.getElementById('question-timer');
    if (timerElement) {
        timerElement.textContent = `${timeRemaining}s`;
        timerElement.style.color = timeRemaining <= 10 ? 'var(--danger-color)' : 'inherit';
    }
}

/**
 * Maneja cuando se acaba el tiempo
 */
function handleTimeUp() {
    feedback.textContent = getLocalizedText('time_up_message');
    feedback.style.color = 'var(--danger-color)';
    showHint();
}

/**
 * Muestra una pista para la pregunta actual
 */
function showHint() {
    if (!currentQuestionData || hintsUsed >= HINTS_PER_QUESTION) return;
    
    const hintElement = document.getElementById('hint-text');
    if (hintElement) {
        hintElement.textContent = currentQuestionData.hints[hintsUsed] || getLocalizedText('no_more_hints');
        hintElement.style.display = 'block';
        hintsUsed++;
    }
}

/**
 * Calcula y actualiza la puntuación
 */
function updateScore(isCorrect, timeBonus = 0) {
    if (isCorrect) {
        const basePoints = 100;
        const timeBonusPoints = Math.floor(timeRemaining * 2);
        const hintPenalty = hintsUsed * 20;
        const questionScore = basePoints + timeBonusPoints - hintPenalty;
        
        score += questionScore;
        saveScore();
        updateScoreDisplay();
    }
}

/**
 * Guarda la puntuación en localStorage
 */
function saveScore() {
    localStorage.setItem(LOCAL_STORAGE_KEY_SCORE, JSON.stringify({
        score,
        level: currentLevel,
        date: new Date().toISOString()
    }));
}

/**
 * Actualiza la visualización de la puntuación
 */
function updateScoreDisplay() {
    const scoreElement = document.getElementById('current-score');
    if (scoreElement) {
        scoreElement.textContent = `Puntuación: ${score}`;
    }
}

/**
 * Descarga el audio desde Make.com
 * @param {string} videoId - ID del video de YouTube
 * @returns {Promise<Blob>} - Blob del audio
 */
async function downloadAudioFromMake(videoId) {
    try {
        const response = await fetch(MAKE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                videoId,
                requestType: 'audio' // Indicar que queremos audio
            })
        });

        if (!response.ok) {
            throw new Error('Error al obtener el audio desde Make.com');
        }

        // Verificar el tipo de contenido
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('audio/')) {
            throw new Error('La respuesta no es un archivo de audio válido');
        }

        // Obtener el blob del audio
        const audioBlob = await response.blob();
        
        // Crear una URL para el blob
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Crear un elemento de audio
        const audio = new Audio(audioUrl);
        
        return audio;
    } catch (error) {
        console.error('Error al descargar el audio:', error);
        throw error;
    }
}