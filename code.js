// --- Elementos del DOM ---
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

// --- Variables Globales ---
let player; // Instancia del reproductor de YouTube
let questions = []; // Almacena las preguntas cargadas
let currentQuestionIndex = 0; // Índice de la pregunta actual
let userAnswers = []; // Almacena las respuestas del usuario para revisión
let currentQuestionData = null; // Almacena la pregunta actual en display
let isQuestionActive = false; // Bandera para saber si una pregunta está siendo mostrada
let currentLocale = {}; // Para las cadenas de texto (i18n)

const LOCAL_STORAGE_KEY_PROGRESS = 'videoInteractiveProgress';
const LOCAL_STORAGE_KEY_ANSWERS = 'videoInteractiveAnswers';

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
    player = new YT.Player('youtube-player', {
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

/**
 * Se ejecuta cuando el reproductor de YouTube está listo.
 */
function onPlayerReady(event) {
    console.log('Reproductor de YouTube listo.');
    loadProgress(); // Cargar progreso al inicio
    // Forzar un onStateChange para iniciar la verificación de preguntas
    player.playVideo(); // Intentar reproducir para obtener el estado PLAYING
    player.pauseVideo(); // Pausar inmediatamente si no hay pregunta activa
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
    currentQuestionData = question; // Guardar la pregunta actual
    questionText.textContent = question.question;
    answersContainer.innerHTML = '';
    feedback.textContent = '';
    submitButton.style.display = 'block'; // Mostrar el botón de enviar

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
    const selectedButton = answersContainer.querySelector('button.selected');

    if (!selectedButton) {
        feedback.textContent = getLocalizedText('select_answer_prompt');
        feedback.style.color = var('--danger-color', '#dc3545');
        return;
    }

    const selectedIndex = parseInt(selectedButton.dataset.index); // Índice original de la respuesta
    const isCorrect = currentQuestionData.answers[selectedIndex].correct;

    // Guardar la respuesta del usuario para el modo revisión
    userAnswers.push({
        question: currentQuestionData.question,
        userAnswer: currentQuestionData.answers[selectedIndex].text,
        correctAnswer: currentQuestionData.answers.find(a => a.correct).text,
        isCorrect: isCorrect
    });
    saveProgress(); // Guardar el progreso y las respuestas

    if (isCorrect) {
        feedback.textContent = getLocalizedText('correct_feedback');
        feedback.style.color = var('--success-color', '#28a745');
        selectedButton.classList.add('correct'); // Resaltar la respuesta correcta
        submitButton.style.display = 'none'; // Ocultar botón de enviar
        resetButton.style.display = 'none'; // Ocultar botón de reiniciar

        // Avanzar a la siguiente pregunta después de un breve delay
        setTimeout(() => {
            questionOverlay.style.display = 'none';
            isQuestionActive = false; // Resetear la bandera
            currentQuestionIndex++; // Mover al siguiente checkpoint
            updateProgressBar(currentQuestionIndex);

            if (currentQuestionIndex < questions.length) {
                player.playVideo(); // Reanudar el video
                checkQuestionTiming(); // Reanudar la verificación de tiempos
            } else {
                // Todas las preguntas respondidas
                showReviewSection();
            }
        }, 1500); // 1.5 segundos de feedback
    } else {
        feedback.textContent = getLocalizedText('incorrect_feedback');
        feedback.style.color = var('--danger-color', '#dc3545');
        selectedButton.classList.add('incorrect'); // Resaltar la respuesta incorrecta
        // Opcional: Permitir al usuario reintentar
        // setTimeout(() => {
        //     selectedButton.classList.remove('incorrect', 'selected');
        //     feedback.textContent = '';
        // }, 1000);
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

// --- Inicialización ---

document.addEventListener('DOMContentLoaded', async function() {
    await loadLocale(); // Cargar el idioma primero

    // Cargar preguntas desde el archivo JSON
    try {
        const response = await fetch('questions.json');
        questions = await response.json();
        // Ordenar las preguntas por tiempo para asegurar el orden correcto
        questions.sort((a, b) => a.time - b.time);
        updateProgressBar(currentQuestionIndex); // Inicializar barra de progreso
        console.log('Preguntas cargadas:', questions);
    } catch (error) {
        console.error('Error al cargar las preguntas:', error);
        alert('Error al cargar las preguntas. La aplicación no puede iniciar.');
    }

    // --- Asignar Eventos ---
    submitButton.addEventListener('click', checkAnswer);
    resetButton.addEventListener('click', resetProgress);
    restartVideoButton.addEventListener('click', resetProgress); // El botón de reiniciar desde la sección de revisión
});

// --- Analítica Ligera (Ejemplo - Necesita tu propia implementación) ---
// Para Google Analytics (Universal Analytics):
/*
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'TU_ID_DE_SEGUIMIENTO_GA'); // Reemplaza con tu ID de seguimiento de GA

function trackEvent(eventName, eventCategory, eventLabel) {
    gtag('event', eventName, {
        'event_category': eventCategory,
        'event_label': eventLabel
    });
}
// Ejemplo de uso: trackEvent('respuesta_correcta', 'video_interactivo', 'Pregunta X');
*/

// Para Fathom Analytics:
/*
// Necesitarás añadir el script de Fathom en tu HTML:
// <script src="https://cdn.usefathom.com/script.js" data-site="TU_ID_DE_SITIO_FATHOM" defer></script>
// Y luego usarlo así:
// fathom.trackGoal('TU_CODIGO_DE_OBJETIVO_FATHOM', 0);
*/

// --- NOTA SOBRE SCORM/LTI ---
// La integración con SCORM o LTI es **MUY COMPLEJA** y no se puede hacer con un simple archivo HTML/JS.
// SCORM requiere empaquetar el contenido con un manifiesto XML y usar la API de tiempo de ejecución (API Runtime)
// para comunicarse con el LMS (Moodle, Canvas, Blackboard, etc.).
// LTI (Learning Tools Interoperability) es un estándar para la comunicación segura entre el LMS y una aplicación externa,
// lo que implica un servidor backend para manejar la autenticación (OAuth 1.0a o OAuth 2.0) y el intercambio de datos.
// Esto va mucho más allá de GitHub Pages y JavaScript del lado del cliente.
// Si necesitas esta funcionalidad, deberás considerar un desarrollo web más completo (backend + frontend)
// o usar una herramienta especializada para crear contenido SCORM/LTI (como H5P, Articulate Storyline, Adobe Captivate, etc.).