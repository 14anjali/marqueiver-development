import { env } from '../config/env.js';
export async function analyzeProfile(input) {
    if (env.aiProvider === 'mock') {
        const totalFollowers = input.socials.reduce((s, a) => s + a.followers, 0);
        const tierRate = totalFollowers > 300000 ? 60000 : totalFollowers > 100000 ? 40000 : 20000;
        return {
            suggestedCategories: deriveCategories(input.bio),
            audienceSummary: `Audience of ~${totalFollowers.toLocaleString('en-IN')} across ${input.socials.length} platforms, ` +
                `India-led with strong engagement. (mock analysis)`,
            suggestedRateCard: [
                { contentType: 'reel', price: tierRate },
                { contentType: 'post', price: Math.round(tierRate * 0.6) },
                { contentType: 'story', price: Math.round(tierRate * 0.3) },
            ],
        };
    }
    return callProvider(input);
}
/** AI Compatibility score brand↔creator (proposal §5.1, §5.2). */
export async function compatibilityScore(creator, brand) {
    // Deterministic heuristic blend — same shape a real model would return.
    const audienceMatch = clamp(60 + (creator.totalAudience > 100000 ? 30 : 15));
    const contentRelevance = clamp(70 + (creator.categories.some((c) => brand.industry.toLowerCase().includes(c.toLowerCase())) ? 25 : 10));
    const brandValues = 90;
    const locationMatch = creator.location && brand.location && creator.location === brand.location ? 100 : 80;
    const engagementQuality = clamp(70 + Math.min(30, Math.round(creator.avgEngagement * 4)));
    const overall = Math.round((audienceMatch + contentRelevance + brandValues + locationMatch + engagementQuality) / 5);
    return { overall, audienceMatch, contentRelevance, brandValues, locationMatch, engagementQuality };
}
function clamp(n) { return Math.max(0, Math.min(100, n)); }
function deriveCategories(bio) {
    const map = {
        fitness: 'Fitness', gym: 'Fitness', workout: 'Fitness',
        food: 'Food', recipe: 'Food', travel: 'Travel',
        tech: 'Tech', fashion: 'Fashion', beauty: 'Beauty', wellness: 'Wellness',
    };
    const found = new Set();
    const lower = bio.toLowerCase();
    for (const [k, v] of Object.entries(map))
        if (lower.includes(k))
            found.add(v);
    return found.size ? [...found] : ['Lifestyle'];
}
async function callProvider(input) {
    const prompt = `Analyse this creator profile and return JSON with suggestedCategories (string[]), ` +
        `audienceSummary (string), suggestedRateCard (array of {contentType, price in INR}). ` +
        `Bio: ${input.bio}. Socials: ${JSON.stringify(input.socials)}. Return ONLY JSON.`;
    if (env.aiProvider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.openaiKey}` },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' },
            }),
        });
        const json = await res.json();
        return JSON.parse(json.choices[0].message.content);
    }
    // Gemini path
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const json = await res.json();
    const text = json.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
    return JSON.parse(text);
}
