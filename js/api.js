/**
 * api.js
 * All communication with the Udemy REST API.
 *
 * Depends on: utils.js, storage.js
 */

const UdemyAPI = {
  /** Resolved domain, e.g. "https://banquemisr25.udemy.com" */
  domain: 'https://www.udemy.com',

  /** Cookie bag populated by `UdemyAPI.initFromCookies()` */
  cookies: {},

  /**
   * Reads all udemy.com cookies from the browser and resolves the correct
   * subdomain (supports corporate Udemy accounts).
   * Calls `onReady(isLoggedIn)` when done.
   *
   * @param {Function} onReady  - callback(isLoggedIn: boolean)
   */
  initFromCookies(onReady) {
    chrome.cookies.getAll({ domain: 'udemy.com' }, (cookies) => {
      const domainMap = {};
      cookies.forEach((c) => {
        UdemyAPI.cookies[c.name] = c.value;
        domainMap[c.name]        = c.domain;
      });

      // Resolve subdomain (corporate accounts use a custom subdomain)
      if (UdemyAPI.cookies['access_token'] && domainMap['access_token']) {
        UdemyAPI.domain =
          'https://' + domainMap['access_token'].replace(/^\./, '');
      }

      const isLoggedIn =
        UdemyAPI.cookies['access_token'] &&
        UdemyAPI.cookies['access_token'].length > 2;

      onReady(!!isLoggedIn);
    });
  },

  /**
   * Builds the standard Udemy auth headers from the stored cookies.
   * @returns {object}
   */
  _buildHeaders() {
    const c = UdemyAPI.cookies;
    return {
      'Content-Type':                         'application/json, text/plain, */*',
      'x-udemy-authorization':                'Bearer ' + c['access_token'],
      'x-udemy-cache-brand':                  c['ud_cache_brand'],
      'x-udemy-cache-campaign-code':          c['ud_cache_campaign_code'],
      'x-udemy-cache-device':                 c['ud_cache_device'],
      'x-udemy-cache-language':               c['ud_cache_language'],
      'x-udemy-cache-logged-in':              c['ud_cache_logged_in'],
      'x-udemy-cache-marketplace-country':    c['ud_cache_marketplace_country'],
      'x-udemy-cache-modern-browser':         c['ud_cache_modern_browser'],
      'x-udemy-cache-price-country':          c['ud_cache_price_country'],
      'x-udemy-cache-release':                c['ud_cache_release'],
      'x-udemy-cache-user':                   c['ud_cache_user'],
      'x-udemy-cache-version':                c['ud_cache_version'],
    };
  },

  /**
   * Performs a synchronous AJAX request to the Udemy API.
   * Returns the parsed JSON response, or `null` on error.
   *
   * NOTE: `async: false` is intentional here — the extension processes the
   * video list sequentially to avoid overwhelming the API.
   *
   * @param {object} config        - { url, type, data }
   * @param {object} [counterObj]  - Passed to UI.updateCounter on each 200 response
   * @returns {object|null}
   */
  request(config, counterObj = '') {
    const result = $.ajax({
      url:     config.url,
      type:    config.type || 'GET',
      headers: UdemyAPI._buildHeaders(),
      async:   false,
      data:    config.data || {},
      statusCode: {
        200(response) {
          UI.updateCounter(counterObj);
          return response;
        },
        404() {
          console.warn('[UdemyAPI] 404 – resource not found:', config.url);
        },
      },
    });
    return result.responseJSON || null;
  },

  // ── High-level fetch methods ───────────────────────────────────────────────

  /**
   * Fetches the full subscribed course list.
   * Uses LocalStorage cache to avoid redundant API calls.
   *
   * @returns {object}  Udemy API response with `.results` array
   */
  fetchCourses() {
    const CACHE_KEY      = 'LoadedAllCourses';
    const CACHE_DATA_KEY = 'LoadedData';
    const alreadyLoaded  = Storage.load(CACHE_KEY);

    if (alreadyLoaded) {
      return Storage.load(CACHE_DATA_KEY);
    }

    const config = {
      url:  UdemyAPI.domain + '/api-2.0/users/me/subscribed-courses/',
      type: 'GET',
      data: {
        page_size:       100,
        ordering:        '-last_accessed',
        'fields[course]': '@min,visible_instructors,image_125_H,favorite_time,archive_time,completion_ratio,last_accessed_time,enrollment_time,is_practice_test_course,features,num_collections,published_title,is_private,buyable_object_type',
        'fields[user]':  '@min,job_title',
        page:            1,
      },
    };

    let data       = UdemyAPI.request(config);
    const total    = parseInt(Math.ceil(data.count / 100), 10);

    // Fetch additional pages when there are more than 100 courses
    if (data.count > 100) {
      for (let i = 0; i < total - 1; i++) {
        config.data.page += 1;
        const more = UdemyAPI.request(config);
        if (more) $.merge(data.results, more.results);
      }
    }

    Storage.save(CACHE_KEY, 1);
    Storage.save(CACHE_DATA_KEY, data);
    return data;
  },

  /**
   * Fetches the curriculum item list for a given course.
   * Uses LocalStorage cache keyed by course ID.
   *
   * @param {string|number} courseId
   * @returns {object}  Raw API response with `.results` array
   */
  fetchPlaylist(courseId) {
    const CACHE_KEY = 'LoadedVideoList';
    let cachedList  = Storage.load(CACHE_KEY);

    if (cachedList) {
      const match = cachedList.find((entry) => entry.courseID === courseId);
      if (match) return match.videoList;
    } else {
      cachedList = [];
    }

    const config = {
      url:  UdemyAPI.domain + '/api-2.0/courses/' + courseId + '/subscriber-curriculum-items',
      type: 'GET',
      data: {
        page_size:          '1400',
        'fields[lecture]':  'title,object_index,is_published,sort_order,created,asset,supplementary_assets,is_free',
        'fields[quiz]':     'title,object_index,is_published,sort_order,type',
        'fields[practice]': 'title,object_index,is_published,sort_order',
        'fields[chapter]':  'title,object_index,is_published,sort_order',
        'fields[asset]':    'title,filename,asset_type,status,time_estimation,is_external',
        caching_intent:     'True',
      },
    };

    const response = UdemyAPI.request(config);
    if (response) {
      cachedList.push({ courseID: courseId, videoList: response });
      Storage.save(CACHE_KEY, cachedList);
    }
    return response;
  },

  /**
   * Fetches the stream/caption/asset details for a single lecture.
   *
   * @param {string|number} courseId
   * @param {string|number} lectureId
   * @param {object}        counterObj  - Passed through to UI.updateCounter
   * @returns {object|null}
   */
  fetchVideoDetails(courseId, lectureId, counterObj) {
    const config = {
      url:  UdemyAPI.domain + '/api-2.0/users/me/subscribed-courses/' + courseId + '/lectures/' + lectureId,
      type: 'GET',
      data: {
        'fields[lecture]': 'asset,description,download_url,is_free,last_watched_second',
        'fields[asset]':   'asset_type,length,stream_urls,captions,thumbnail_sprite,slides,slide_urls,download_urls,image_125_H,body',
      },
    };
    return UdemyAPI.request(config, counterObj);
  },

  // ── Video list processing ──────────────────────────────────────────────────

  /**
   * Fetches and processes the entire playlist for a course, returning an array
   * of normalised video/article objects ready for rendering.
   *
   * @param {string|number} courseId
   * @param {Function} onProgress  - Called with (current, total) after each lecture
   * @returns {Promise<Array>}
   */
  async buildVideoList(courseId, onProgress) {
    const rawPlaylist = UdemyAPI.fetchPlaylist(courseId);
    if (!rawPlaylist) return [];

    // Filter to lectures (videos + articles) and attach chapter info
    const lectures = [];
    let currentChapter = '';
    rawPlaylist.results.forEach((element) => {
      if (element._class === 'chapter') {
        currentChapter = element.object_index + '. ' + element.title;
      } else if (
        element._class === 'lecture' &&
        element.asset &&
        (element.asset.asset_type === 'Video' || element.asset.asset_type === 'Article')
      ) {
        element.chapter = currentChapter;
        lectures.push(element);
      }
    });

    const apiDelay = parseInt(Storage.getSetting('api_delay'), 10);
    const videoList = [];

    await asyncForEach(lectures, async (lecture, index) => {
      try {
        await waitFor(apiDelay);

        const details = UdemyAPI.fetchVideoDetails(courseId, lecture.id, { Current: index + 1 });
        onProgress(index + 1, lectures.length);

        const entry = UdemyAPI._normaliseLecture(lecture, details);
        videoList.push(entry);
      } catch (err) {
        console.error('[UdemyAPI] Error fetching lecture', lecture.id, err);
      }
    });

    return videoList;
  },

  /**
   * Converts raw API lecture + details objects into a normalised video entry.
   * @private
   */
  _normaliseLecture(lecture, details) {
    const isArticle = details && details.asset && details.asset.asset_type === 'Article';
    const isValidVideo =
      details &&
      details.asset &&
      details.asset.stream_urls &&
      details.asset.stream_urls.Video &&
      details.asset.stream_urls.Video[0];

    if (isArticle) {
      const html = details.asset.body || lecture.description || '<h1>No Content</h1>';
      const fullHtml =
        '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>' +
        lecture.title +
        '</title>\n<style>\nbody { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }\nimg { max-width: 100%; height: auto; }\n</style>\n</head>\n<body>\n' +
        html +
        '\n</body>\n</html>';
      const b64     = btoa(unescape(encodeURIComponent(fullHtml)));
      const dataUri = 'data:text/html;base64,' + b64;

      return {
        id:             lecture.id,
        VideoUrl:       dataUri,
        VideoTitle:     lecture.object_index + '. ' + lecture.title + " <span class='badge badge-secondary'>Article</span>",
        TitleRaw:       lecture.title,
        IndexRaw:       lecture.object_index,
        VideoThumbnail: '',
        VideoQuality:   'HTML',
        Streams:        [],
        Captions:       [],
        Assets:         lecture.supplementary_assets || [],
        Chapter:        lecture.chapter,
        Type:           'Article',
      };
    }

    if (!isValidVideo) {
      console.warn('[UdemyAPI] Skipping lecture', lecture.id, '– missing stream data');
      // Increment global error counter (matches original Errors += 1 behavior)
      if (typeof App !== 'undefined') App.errors++;
      return {
        id:             lecture.id,
        VideoUrl:       '',
        VideoTitle:     lecture.object_index + '. ' + lecture.title + " <div class='btn-danger'>ERROR</div>",
        TitleRaw:       lecture.title,
        IndexRaw:       lecture.object_index,
        VideoThumbnail: (details && details.asset && details.asset.thumbnail_sprite)
          ? details.asset.thumbnail_sprite.img_url
          : '',
        VideoQuality:   'Auto',
        Chapter:        lecture.chapter,
        Type:           'Video',
        _error:         true,
      };
    }

    return {
      id:             lecture.id,
      VideoUrl:       details.asset.stream_urls.Video[0].file,
      VideoTitle:     lecture.object_index + '. ' + lecture.title,
      TitleRaw:       lecture.title,
      IndexRaw:       lecture.object_index,
      VideoThumbnail: details.asset.thumbnail_sprite ? details.asset.thumbnail_sprite.img_url : '',
      VideoQuality:   details.asset.stream_urls.Video[0].label,
      Streams:        details.asset.stream_urls.Video.map((s) => ({ label: s.label, file: s.file })),
      Captions:       details.asset.captions || [],
      Assets:         lecture.supplementary_assets || [],
      Chapter:        lecture.chapter,
      Type:           'Video',
    };
  },
};
