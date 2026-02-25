/**
 * Vercel Serverless Function: Smart Text Summarization
 * Uses improved extractive summarization algorithm
 * Fast, reliable, and completely free
 */

const cache = new Map();
const CACHE_TTL = 3600000; // 1 hour

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { text } = req.body;
    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Invalid text provided' });
    }

    if (text.length === 0) {
        return res.status(400).json({ error: 'Text cannot be empty' });
    }

    try {
        // Check cache first
        const hash = generateHash(text);
        const cached = getFromCache(hash);
        if (cached) {
            return res.json({ summary: cached, cached: true });
        }

        // Use smart extractive summarization
        const summary = summarizeExtractively(text);
        
        // Cache the result
        setCache(hash, summary);
        
        res.json({ summary, cached: false });
    } catch (err) {
        console.error('Summarization error:', err);
        res.status(500).json({ error: err.message || 'Failed to summarize' });
    }
}

/**
 * Smart extractive summarization
 * Creates concise summaries by selecting key information
 */
function summarizeExtractively(text) {
    const cleanText = text.substring(0, 2000).trim();
    
    // Split into sentences more intelligently
    // Only split on period/exclamation/question mark when followed by space and capital letter, or at text end
    // This avoids splitting on email addresses (text@domain.co.uk) or decimals (3.14)
    const sentenceRegex = /(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])$/g;
    let sentences = cleanText.split(sentenceRegex)
        .filter(s => s.trim().length > 10)
        .map(s => s.trim());
    
    // Fallback: if regex split fails, use simple split
    if (sentences.length === 0 || sentences.length === 1 && sentences[0] === cleanText) {
        sentences = cleanText.split(/[.!?]+/)
            .filter(s => s.trim().length > 10)
            .map(s => s.trim());
    }
    
    if (sentences.length === 0) {
        return limitToWords(cleanText, 50);
    }
    
    if (sentences.length === 1) {
        return limitToWords(sentences[0], 50);
    }
    
    // Calculate word frequencies (excluding common words)
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once']);
    
    const wordFreq = {};
    const words = cleanText.toLowerCase().match(/\b\w+\b/g) || [];
    
    words.forEach(word => {
        if (word.length > 3 && !stopWords.has(word)) {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
    });
    
    // Score sentences based on important content
    const scoredSentences = sentences.map((sentence, index) => {
        const sentenceWords = sentence.toLowerCase().match(/\b\w+\b/g) || [];
        const wordCount = sentenceWords.length;
        const importantWords = sentenceWords.filter(w => w.length > 3 && !stopWords.has(w));
        
        // Score based on frequency of important words
        const freqScore = importantWords.reduce((sum, word) => {
            return sum + (wordFreq[word] || 0);
        }, 0);
        
        // Strong preference for concise sentences (10-15 words is ideal)
        let lengthScore = 1.0;
        if (wordCount <= 15) {
            lengthScore = 2.0; // Boost short sentences
        } else if (wordCount <= 20) {
            lengthScore = 1.2;
        } else {
            lengthScore = 0.5; // Penalize long sentences
        }
        
        // Moderate preference for first few sentences
        const positionBonus = index === 0 ? 1.5 : (index === 1 ? 1.2 : 1.0);
        
        const score = (freqScore / Math.max(importantWords.length, 1)) * lengthScore * positionBonus;
        
        return {
            text: sentence.trim(),
            score: score,
            index,
            wordCount: wordCount
        };
    });
    
    // Sort by score (best first)
    scoredSentences.sort((a, b) => b.score - a.score);
    
    // Build summary by selecting best sentences that fit in 50 words
    const maxWords = 50;
    let selectedSentences = [];
    let totalWords = 0;
    
    // Try to fit multiple high-scoring sentences
    for (const sent of scoredSentences) {
        if (totalWords + sent.wordCount <= maxWords) {
            selectedSentences.push(sent);
            totalWords += sent.wordCount;
        }
    }
    
    // If we didn't select anything (all sentences too long), take the best one and truncate
    if (selectedSentences.length === 0) {
        return limitToWords(scoredSentences[0].text, 50);
    }
    
    // Re-sort selected sentences by original position for coherent flow
    selectedSentences.sort((a, b) => a.index - b.index);
    
    // Combine sentences, removing trailing periods before joining
    const sentenceTexts = selectedSentences.map(s => s.text.replace(/[.!?]+$/, ''));
    const combined = sentenceTexts.join('. ');
    
    // Check if last word is an email or URL - if so, don't add final period
    const lastWord = combined.split(/\s+/).pop() || '';
    const hasEmailOrUrl = lastWord.includes('@') || lastWord.includes('://') || lastWord.includes('www.');
    
    return hasEmailOrUrl ? combined : combined + '.';
}

/**
 * Simple in-memory cache (works on Vercel)
 */
function generateHash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
}

function getFromCache(hash) {
    const entry = cache.get(hash);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
        return entry.value;
    }
    cache.delete(hash);
    return null;
}

function setCache(hash, value) {
    cache.set(hash, { value, timestamp: Date.now() });
    
    // Keep cache size reasonable (max 100 entries)
    if (cache.size > 100) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
}

/**
 * Limit text to a specific number of words
 */
function limitToWords(text, maxWords) {
    const words = text.trim().split(/\s+/).filter(w => w);
    if (words.length <= maxWords) return words.join(' ');
    return words.slice(0, maxWords).join(' ') + '...';
}
