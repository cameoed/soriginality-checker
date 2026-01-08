(function() {
    // ------------------------------------------
    // 1. SHARED UTILS
    // ------------------------------------------
    
    // Finds the best quality thumbnail from the Post object
    function getBestImage(p) {
        if (!p) return null;

        // 1. Check Encodings/Download URLs (Deepest/Best source)
        if (p.attachments && p.attachments.length > 0) {
            const att = p.attachments[0];
            
            // Check encodings structure first (Standard)
            if (att.encodings) {
                if (att.encodings.thumbnail && att.encodings.thumbnail.path) return att.encodings.thumbnail.path;
                if (att.encodings.md && att.encodings.md.path) return att.encodings.md.path;
                if (att.encodings.source && att.encodings.source.path) return att.encodings.source.path;
            }
            
            // Check download_urls structure (Fallback)
            if (att.download_urls && att.download_urls.thumbnail) {
                return att.download_urls.thumbnail;
            }
        }

        // 2. Fallback to basic preview
        return p.preview_image_url || null;
    }

    // Formats the data into a standard object for the extension
    function formatItem(postObj, profileObj) {
        const img = getBestImage(postObj);
        if (!img) return null;

        return {
            postLink: postObj.permalink || window.location.href,
            imageUrl: img,
            username: (profileObj && profileObj.username) ? profileObj.username : 'Unknown_User'
        };
    }

    // ------------------------------------------
    // 2. PARSING LOGIC
    // ------------------------------------------

    // SCENARIO 1: Profile Feed (List of items)
    // Data structure: { items: [ { post: {...}, profile: {...} } ] }
    function handleProfileFeed(data) {
        if (!data || !data.items) return;

        const extracted = data.items.map(item => {
            return formatItem(item.post, item.profile);
        }).filter(Boolean);

        if (extracted.length > 0) {
            window.postMessage({ type: "SORIGINAL_FOUND", data: extracted }, "*");
        }
    }

    // SCENARIO 2: Single Post (Specific ID)
    // Data structure: { post: {...}, profile: {...} } at the root level
    function handleSinglePost(data) {
        if (!data) return;

        // Extract root level objects based on your provided JSON
        const postObj = data.post; 
        const profileObj = data.profile;

        if (!postObj) return; 

        const formatted = formatItem(postObj, profileObj);

        if (formatted) {
            // Send as an array so the background script treats it like a batch of 1
            window.postMessage({ type: "SORIGINAL_FOUND", data: [formatted] }, "*");
        }
    }

    // ------------------------------------------
    // 3. FETCH OVERRIDE
    // ------------------------------------------
    const { fetch: originalFetch } = window;

    window.fetch = async (...args) => {
        const [resource, config] = args;
        const response = await originalFetch(resource, config);
        const url = resource instanceof Request ? resource.url : resource;

        // 1. Profile Feed Detection
        if (url.includes("profile_feed")) {
            const clone = response.clone();
            clone.json().then(data => handleProfileFeed(data)).catch(() => {});
        }
        
        // 2. Single Post Detection
        // Matches: /backend/project_y/post/s_...
        // Excludes: /tree (which loads comments/replies, preventing duplicates)
        else if (url.includes("/backend/project_y/post/") && !url.includes("/tree")) {
            const clone = response.clone();
            clone.json().then(data => handleSinglePost(data)).catch(() => {});
        }

        return response;
    };

    // ------------------------------------------
    // 4. XHR OVERRIDE (Fallback for older request types)
    // ------------------------------------------
    const XHR = XMLHttpRequest.prototype;
    const open = XHR.open;
    const send = XHR.send;

    XHR.open = function(method, url) {
        this._url = url;
        return open.apply(this, arguments);
    };

    XHR.send = function(postData) {
        this.addEventListener('load', function() {
            if (this._url) {
                // Profile Feed
                if (this._url.includes("profile_feed")) {
                    try {
                        const data = JSON.parse(this.response);
                        handleProfileFeed(data);
                    } catch (e) {}
                }
                // Single Post
                else if (this._url.includes("/backend/project_y/post/") && !this._url.includes("/tree")) {
                    try {
                        const data = JSON.parse(this.response);
                        handleSinglePost(data);
                    } catch (e) {}
                }
            }
        });
        return send.apply(this, arguments);
    };

    console.log("Soriginal: Interceptors Active (Feed & Single Post Mode).");
})();