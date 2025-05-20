// Configuración de la API de OpenAI
let OPENAI_API_KEY = localStorage.getItem('openai_api_key') || '';
let YOUTUBE_API_KEY = localStorage.getItem('youtube_api_key') || '';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Configura las API keys
 * @param {string} openaiKey - API key de OpenAI
 * @param {string} youtubeKey - API key de YouTube
 */
function configureAPIKeys(openaiKey, youtubeKey) {
    OPENAI_API_KEY = openaiKey;
    YOUTUBE_API_KEY = youtubeKey;
    localStorage.setItem('openai_api_key', openaiKey);
    localStorage.setItem('youtube_api_key', youtubeKey);
}

/**
 * Verifica que las API keys estén configuradas
 * @returns {boolean} - true si las keys están configuradas
 */
function areAPIKeysConfigured() {
    return OPENAI_API_KEY && YOUTUBE_API_KEY;
}

/**
 * Obtiene la transcripción del video de YouTube
 * @param {string} videoId - ID del video de YouTube
 * @returns {Promise<string>} - Transcripción del video
 */
async function getVideoTranscription(videoId) {
    if (!YOUTUBE_API_KEY) {
        throw new Error('API key de YouTube no configurada');
    }

    try {
        // Primero obtenemos los subtítulos disponibles
        const response = await fetch(`https://www.googleapis.com/youtube/v3/captions?videoId=${videoId}&part=snippet`, {
            headers: {
                'Authorization': `Bearer ${YOUTUBE_API_KEY}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Error al obtener subtítulos: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.items || data.items.length === 0) {
            throw new Error('No se encontraron subtítulos para este video');
        }
        
        // Buscamos los subtítulos en español o inglés
        const captions = data.items.find(item => 
            item.snippet.language === 'es' || item.snippet.language === 'en'
        );
        
        if (!captions) {
            throw new Error('No se encontraron subtítulos en español o inglés');
        }
        
        // Obtenemos el contenido de los subtítulos
        const captionResponse = await fetch(`https://www.googleapis.com/youtube/v3/captions/${captions.id}`, {
            headers: {
                'Authorization': `Bearer ${YOUTUBE_API_KEY}`
            }
        });
        
        if (!captionResponse.ok) {
            throw new Error(`Error al obtener el contenido de los subtítulos: ${captionResponse.statusText}`);
        }
        
        const captionData = await captionResponse.json();
        return captionData.text;
        
    } catch (error) {
        console.error('Error al obtener la transcripción:', error);
        throw error;
    }
}

/**
 * Obtiene información del video de YouTube
 * @param {string} videoId - ID del video de YouTube
 * @returns {Promise<Object>} - Información simulada del video
 */
async function getVideoInfo(videoId) {
    // Validar que el ID tenga 11 caracteres (formato de YouTube)
    if (!videoId || videoId.length !== 11) {
        throw new Error('ID de video inválido');
    }
    // Devolver objeto simulado
    return {
        title: '',
        description: '',
        duration: 0
    };
}

/**
 * Genera preguntas basadas en el contenido del video
 * @param {string} videoId - ID del video de YouTube
 * @param {string} title - Título del video
 * @param {string} description - Descripción del video
 * @returns {Promise<Object>} - Objeto con las preguntas generadas
 */
async function generateQuestions(videoId, title, description) {
    if (!OPENAI_API_KEY) {
        throw new Error('API key de OpenAI no configurada');
    }

    try {
        // Obtener la transcripción del video
        const transcription = await getVideoTranscription(videoId);
        
        // Obtener la duración del video para calcular el número de preguntas
        const duration = await getVideoDuration(videoId);
        const minutes = Math.ceil(duration / 60);
        const numQuestions = Math.max(5, minutes);
        
        // Preparar el prompt para OpenAI
        const prompt = `Basado en el siguiente contenido de un video de YouTube:
        
        Título: ${title}
        Descripción: ${description}
        Transcripción: ${transcription}
        
        Genera ${numQuestions} preguntas de opción múltiple que:
        1. Sean relevantes para el contenido del video
        2. Tengan 4 opciones de respuesta cada una
        3. Solo una respuesta sea correcta
        4. Incluyan 2 pistas para cada pregunta
        5. Sean de dificultad variada
        6. Se distribuyan a lo largo del video (una por minuto aproximadamente)
        
        Formato de respuesta en JSON:
        {
            "questions": [
                {
                    "question": "texto de la pregunta",
                    "time": tiempo_en_segundos,
                    "answers": [
                        {"text": "respuesta 1", "correct": true/false},
                        {"text": "respuesta 2", "correct": true/false},
                        {"text": "respuesta 3", "correct": true/false},
                        {"text": "respuesta 4", "correct": true/false}
                    ],
                    "hints": ["pista 1", "pista 2"]
                }
            ]
        }`;

        // Llamar a la API de OpenAI
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: "Eres un experto en crear preguntas educativas basadas en contenido de video. Genera preguntas que se distribuyan uniformemente a lo largo del video, aproximadamente una por minuto."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.7
            })
        });

        if (!response.ok) {
            throw new Error(`Error en la API de OpenAI: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('Respuesta inválida de OpenAI');
        }

        const questions = JSON.parse(data.choices[0].message.content);
        
        // Validar el formato de las preguntas
        if (!questions.questions || !Array.isArray(questions.questions)) {
            throw new Error('Formato de preguntas inválido');
        }
        
        // Distribuir las preguntas a lo largo del video
        questions.questions = distributeQuestions(questions.questions, duration);
        
        return questions;
    } catch (error) {
        console.error('Error al generar preguntas:', error);
        throw error;
    }
}

/**
 * Obtiene la duración del video en segundos
 * @param {string} videoId - ID del video de YouTube
 * @returns {Promise<number>} - Duración en segundos
 */
async function getVideoDuration(videoId) {
    try {
        const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=contentDetails&key=${YOUTUBE_API_KEY}`);
        const data = await response.json();
        
        if (!data.items || data.items.length === 0) {
            throw new Error('Video no encontrado');
        }
        
        // Convertir la duración ISO 8601 a segundos
        const duration = data.items[0].contentDetails.duration;
        const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
        
        const hours = (match[1] ? parseInt(match[1]) : 0);
        const minutes = (match[2] ? parseInt(match[2]) : 0);
        const seconds = (match[3] ? parseInt(match[3]) : 0);
        
        return hours * 3600 + minutes * 60 + seconds;
    } catch (error) {
        console.error('Error al obtener la duración del video:', error);
        throw error;
    }
}

/**
 * Distribuye las preguntas a lo largo del video
 * @param {Array} questions - Array de preguntas
 * @param {number} duration - Duración del video en segundos
 * @returns {Array} - Preguntas con tiempos asignados
 */
function distributeQuestions(questions, duration) {
    const minutes = Math.ceil(duration / 60);
    const interval = Math.floor(duration / minutes);
    
    return questions.map((question, index) => ({
        ...question,
        time: Math.min(interval * (index + 1), duration - 30) // Asegurar que la última pregunta no esté al final del video
    }));
}

/**
 * Guarda las preguntas en localStorage
 * @param {string} videoId - ID del video
 * @param {Object} questions - Objeto con las preguntas
 */
function saveQuestions(videoId, questions) {
    try {
        localStorage.setItem(`questions_${videoId}`, JSON.stringify(questions));
    } catch (error) {
        console.error('Error al guardar las preguntas:', error);
    }
}

/**
 * Carga las preguntas desde localStorage
 * @param {string} videoId - ID del video
 * @returns {Object|null} - Objeto con las preguntas o null si no existen
 */
function loadQuestions(videoId) {
    try {
        const questions = localStorage.getItem(`questions_${videoId}`);
        return questions ? JSON.parse(questions) : null;
    } catch (error) {
        console.error('Error al cargar las preguntas:', error);
        return null;
    }
}

// Exportar las funciones necesarias
export {
    generateQuestions,
    getVideoInfo,
    saveQuestions,
    loadQuestions,
    configureAPIKeys,
    areAPIKeysConfigured
}; 