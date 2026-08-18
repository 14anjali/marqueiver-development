// Data lifted straight from the reference screens so the UI matches 1:1.
// Portraits use deterministic Unsplash source URLs (swap for real assets later).

const portrait = (seed) => `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=600&q=70`;

export const creators = [
  {
    id: 'damyanti', name: 'Damyanti Verma', role: 'Fitness & Lifestyle Creator',
    city: 'Delhi, India', img: portrait('photo-1544005313-94ddf0286df2'),
    total: '258.6K', engRate: '5.8%', startRate: '₹45,000', score: '95/100', response: 'Within 24 hrs',
    socials: [['instagram', '52.4K'], ['youtube', '128K'], ['linkedin', '18K'], ['tiktok', '16K'], ['x', '12K']], extra: 2,
    tags: ['Fitness', 'Lifestyle', 'Wellness'], moreTags: 3,
  },
  {
    id: 'rohit', name: 'Rohit Sharma', role: 'Tech & Productivity Creator',
    city: 'Bangalore, India', img: portrait('photo-1507003211169-0a1dd7228f2d'),
    total: '312.7K', engRate: '4.3%', startRate: '₹60,000',
    socials: [['instagram', '68.3K'], ['youtube', '156K'], ['linkedin', '34K'], ['x', '22K']], extra: 2,
    tags: ['Tech', 'Productivity', 'Gadgets'], moreTags: 2,
  },
  {
    id: 'ananya', name: 'Ananya Singh', role: 'Fashion & Beauty Creator',
    city: 'Mumbai, India', img: portrait('photo-1524504388940-b1c1722653e1'),
    total: '487.2K', engRate: '6.2%', startRate: '₹55,000',
    socials: [['instagram', '131K'], ['youtube', '215K'], ['tiktok', '78K'], ['pinterest', '24K']], extra: 2,
    tags: ['Fashion', 'Beauty', 'Lifestyle'], moreTags: 3,
  },
  {
    id: 'vikram', name: 'Vikram Kapoor', role: 'Travel Creator',
    city: 'Goa, India', img: portrait('photo-1500648767791-00dcc994a43e'),
    total: '362.1K', engRate: '4.9%', startRate: '₹70,000',
    socials: [['instagram', '92K'], ['youtube', '182K'], ['facebook', '28K'], ['tiktok', '32K']], extra: 1,
    tags: ['Travel', 'Adventure', 'Vlogs'], moreTags: 2,
  },
  {
    id: 'neha', name: 'Neha Patel', role: 'Yoga & Wellness Creator',
    city: 'Pune, India', img: portrait('photo-1518611012118-696072aa579a'),
    total: '189.4K', engRate: '5.1%', startRate: '₹35,000',
    socials: [['instagram', '45K'], ['youtube', '78K'], ['tiktok', '28K'], ['pinterest', '16K']], extra: 1,
    tags: ['Yoga', 'Wellness', 'Health'], moreTags: 2,
  },
  {
    id: 'arjun', name: 'Arjun Mehta', role: 'Finance & Investing Creator',
    city: 'Delhi, India', img: portrait('photo-1519085360753-af0119f7cbe7'),
    total: '276.3K', engRate: '3.6%', startRate: '₹65,000',
    socials: [['youtube', '145K'], ['linkedin', '52K'], ['instagram', '38K'], ['x', '25K']], extra: 1,
    tags: ['Finance', 'Investing', 'Education'], moreTags: 2,
  },
  {
    id: 'kritika', name: 'Kritika Joshi', role: 'Photography Creator',
    city: 'Jaipur, India', img: portrait('photo-1502378735452-bc7d86632805'),
    total: '154.8K', engRate: '7.2%', startRate: '₹40,000',
    socials: [['instagram', '88K'], ['youtube', '18K'], ['pinterest', '32K'], ['tiktok', '9K']], extra: 1,
    tags: ['Photography', 'Travel', 'Lifestyle'], moreTags: 2,
  },
  {
    id: 'kabir', name: 'Kabir Malhotra', role: 'Motivation & Life Coach',
    city: 'Mumbai, India', img: portrait('photo-1506794778202-cad84cf45f1d'),
    total: '224.5K', engRate: '4.1%', startRate: '₹50,000',
    socials: [['youtube', '122K'], ['instagram', '56K'], ['linkedin', '18K'], ['facebook', '12K']], extra: 1,
    tags: ['Motivation', 'Education', 'Lifestyle'], moreTags: 2,
  },
];

export const filterTags = ['Fitness ✕', 'India ✕', 'Instagram 50K+ ✕'];
export const savedSearches = ['Fitness Creators - India', 'Tech Creators - 50K+', 'Fashion Creators - 100K+'];

// Full Damyanti profile (creator profile screen)
export const damyanti = {
  ...creators[0],
  cover: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1400&q=70',
  verified: true,
  responseTime: '24 Hrs', responseRate: '98%',
  compat: { overall: 95, label: 'Excellent Match',
    rows: [['Audience Match', 92], ['Content Relevance', 98], ['Brand Values', 90], ['Location Match', 100], ['Engagement Quality', 94]] },
  platforms: [
    { name: 'instagram', handle: '@damyanti.verma', verified: true, main: '52.4K', mainLabel: 'Followers', delta: '+12.4%', a: ['Eng. Rate', '5.8%'], b: ['Reach (30D)', '312K'], line: 'pink' },
    { name: 'youtube', handle: '@DamyantiVerma', verified: true, main: '128K', mainLabel: 'Subscribers', delta: '+8.7%', a: ['Eng. Rate', '6.2%'], b: ['Views (30D)', '1.2M'], line: 'red' },
    { name: 'linkedin', handle: 'Damyanti Verma', main: '18K', mainLabel: 'Followers', delta: '+15.3%', a: ['Eng. Rate', '4.1%'], b: ['Impressions (30D)', '156K'], line: 'blue' },
  ],
  smallPlatforms: [
    { name: 'facebook', handle: 'Damyanti Verma', main: '8.2K', delta: '+6.4%', eng: '3.2%' },
    { name: 'tiktok', handle: '@damyanti.verma', main: '16K', delta: '+9.1%', eng: '7.6%' },
    { name: 'threads', handle: '@damyanti.verma', main: '12K', delta: '+10.2%', eng: '5.4%' },
    { name: 'x', handle: '@damyantiverma_', main: '12K', delta: '+4.3%', eng: '2.1%' },
  ],
  audience: {
    locations: [['India', 72], ['United States', 12], ['UAE', 6], ['United Kingdom', 4], ['Canada', 3], ['Others', 3]],
    female: 72, male: 28,
    interests: ['Fitness', 'Health & Wellness', 'Lifestyle', 'Fashion', 'Yoga', 'Travel'],
  },
  rateCard: [['Instagram Post', '₹25,000'], ['Instagram Reel', '₹45,000'], ['YouTube Video', '₹75,000'], ['UGC Video', '₹30,000']],
  collabs: ['Nike', 'PUMA', 'boAt', 'mamaearth'],
  reviewsScore: 4.9, reviewsCount: 32,
};

// Nike brand profile
export const nike = {
  name: 'Nike', verified: true, category: 'Sportswear • Global',
  cover: 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=1400&q=70',
  tagline: 'Inspiring athletes and getting innovation to every athlete in the world.',
  location: 'Beaverton, Oregon, USA', website: 'nike.com',
  stats: [['320', 'Campaigns Completed'], ['1.8K', 'Creators Worked With'], ['99%', 'Payment Success'], ['2 hrs', 'Avg. Response Time']],
  rating: 4.9, ratingCount: 128,
  trust: { score: '4.9/5', label: 'Excellent',
    rows: [['Payment Reliability', '4.9/5'], ['Communication', '4.8/5'], ['Campaign Experience', '4.9/5'], ['Repeat Collaboration', '4.8/5']] },
  verifications: ['Business Verified', 'Website Verified', 'GST Verified', 'Social Media Verified', 'Email Verified'],
  why: [
    ['On-time Payments', '99% payment success rate'],
    ['Clear Briefs', 'Detailed campaigns & support'],
    ['Long-term Relationships', 'Many repeat collaborations'],
    ['Respect for Creativity', 'Creative freedom & trust'],
  ],
  about: {
    text: "Nike is the world's leading innovator in athletic footwear, apparel, equipment and accessories. Our mission is what drives us to do everything possible to expand human potential.",
    rows: [['Founded', '1972'], ['Industry', 'Sportswear'], ['Company Size', '10,001+ employees'], ['Headquarters', 'Beaverton, Oregon, USA'], ['Active in', '190+ Countries'], ['Official Website', 'nike.com']],
    budget: '₹25K - ₹2,00,000', payTime: 'Within 3 - 5 days',
  },
  campaigns: [
    { title: 'Fitness Reels Campaign', tags: ['Reels', 'Fitness'], loc: 'India', pay: '₹45,000', left: '4 days left', img: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=300&q=70' },
    { title: 'Running & Training UGC', tags: ['UGC', 'Shoes'], loc: 'Pan India', pay: '₹30,000', left: '7 days left', img: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=300&q=70' },
    { title: 'Nike Women Campaign', tags: ['Reels', 'Women'], loc: 'India', pay: '₹60,000', left: '10 days left', img: 'https://images.unsplash.com/photo-1518310383802-640c2de311b2?auto=format&fit=crop&w=300&q=70' },
  ],
  team: [['Priya Nair', 'Marketing Director'], ['Rohit Singh', 'Campaign Manager'], ['Aditi Kapoor', 'Partnerships Lead']],
  topCreators: [
    ['Sarah Sharma', 'Fitness Creator', '125K followers'],
    ['Rajat Verma', 'Running Creator', '280K followers'],
    ['Anjali Mehta', 'Yoga Creator', '65K followers'],
    ['Karan Malhotra', 'Sports Influencer', '310K followers'],
  ],
};
