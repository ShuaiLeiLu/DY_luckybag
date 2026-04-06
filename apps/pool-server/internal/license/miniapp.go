package license

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

const (
	defaultMiniAppSessionTTL = 24 * time.Hour
)

// MiniAppSession 描述小程序登录会话。
type MiniAppSession struct {
	SessionToken string `json:"sessionToken"`
	OpenID       string `json:"openId"`
	UnionID      string `json:"unionId"`
	ExpireAtMS   int64  `json:"expireAt"`
}

// MiniAppBindView 描述小程序可见的绑定会话视图。
type MiniAppBindView struct {
	BindToken         string `json:"bindToken"`
	SceneCode         string `json:"sceneCode"`
	Status            string `json:"status"`
	Message           string `json:"message"`
	ClientLabel       string `json:"clientLabel"`
	AppVersion        string `json:"appVersion"`
	WechatNickname    string `json:"wechatNickname"`
	Authorized        bool   `json:"authorized"`
	AdUnlockDays      int    `json:"adUnlockDays"`
	ExpireAtMS        int64  `json:"expireAt"`
	RemainingSec      int64  `json:"remainingSec"`
	ScannedAtMS       int64  `json:"scannedAt"`
	GrantedAtMS       int64  `json:"grantedAt"`
	LicenseExpireAtMS int64  `json:"licenseExpireAt"`
}

type miniAppSessionClaims struct {
	OpenID     string `json:"openId"`
	UnionID    string `json:"unionId"`
	IssuedAtMS int64  `json:"issuedAt"`
	ExpireAtMS int64  `json:"expireAt"`
}

type wechatCode2SessionResponse struct {
	OpenID     string `json:"openid"`
	UnionID    string `json:"unionid"`
	SessionKey string `json:"session_key"`
	ErrCode    int    `json:"errcode"`
	ErrMsg     string `json:"errmsg"`
}

type wechatAccessTokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	ErrCode     int    `json:"errcode"`
	ErrMsg      string `json:"errmsg"`
}

type wechatMiniAppCodeError struct {
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
}

// MiniAppLogin 使用 wx.login 返回的 code 换取用户 openid，并签发服务端会话。
func (s *Service) MiniAppLogin(ctx context.Context, code string) (MiniAppSession, error) {
	if err := s.ensureMiniAppReady(); err != nil {
		return MiniAppSession{}, err
	}
	code = strings.TrimSpace(code)
	if code == "" {
		return MiniAppSession{}, fmt.Errorf("miniapp_login_code_required")
	}
	wxResp, err := s.exchangeMiniAppCode(ctx, code)
	if err != nil {
		return MiniAppSession{}, err
	}
	if strings.TrimSpace(wxResp.OpenID) == "" {
		return MiniAppSession{}, fmt.Errorf("miniapp_openid_empty")
	}
	expireAt := time.Now().Add(s.miniAppSessionTTL())
	token, err := s.signMiniAppSession(miniAppSessionClaims{
		OpenID:     strings.TrimSpace(wxResp.OpenID),
		UnionID:    strings.TrimSpace(wxResp.UnionID),
		IssuedAtMS: time.Now().UnixMilli(),
		ExpireAtMS: expireAt.UnixMilli(),
	})
	if err != nil {
		return MiniAppSession{}, err
	}
	return MiniAppSession{
		SessionToken: token,
		OpenID:       strings.TrimSpace(wxResp.OpenID),
		UnionID:      strings.TrimSpace(wxResp.UnionID),
		ExpireAtMS:   expireAt.UnixMilli(),
	}, nil
}

// VerifyMiniAppSession 校验并解析小程序会话。
func (s *Service) VerifyMiniAppSession(sessionToken string) (MiniAppSession, error) {
	if err := s.ensureMiniAppReady(); err != nil {
		return MiniAppSession{}, err
	}
	claims, err := s.parseMiniAppSession(sessionToken)
	if err != nil {
		return MiniAppSession{}, err
	}
	if claims.ExpireAtMS > 0 && time.Now().UnixMilli() >= claims.ExpireAtMS {
		return MiniAppSession{}, fmt.Errorf("miniapp_session_expired")
	}
	return MiniAppSession{
		SessionToken: strings.TrimSpace(sessionToken),
		OpenID:       strings.TrimSpace(claims.OpenID),
		UnionID:      strings.TrimSpace(claims.UnionID),
		ExpireAtMS:   claims.ExpireAtMS,
	}, nil
}

// MiniAppGetBindSession 返回脱敏后的绑定会话，供小程序展示。
func (s *Service) MiniAppGetBindSession(ctx context.Context, bindRef string) (MiniAppBindView, error) {
	if err := s.ensureMiniAppReady(); err != nil {
		return MiniAppBindView{}, err
	}
	bindToken, err := s.resolveMiniAppBindToken(ctx, bindRef)
	if err != nil {
		return MiniAppBindView{}, err
	}
	session, err := s.GetBindSession(ctx, bindToken)
	if err != nil {
		return MiniAppBindView{}, err
	}
	return buildMiniAppBindView(session), nil
}

// MiniAppScanBindSession 使用小程序会话确认扫码绑定。
func (s *Service) MiniAppScanBindSession(ctx context.Context, bindRef, sessionToken, nickname string) (MiniAppBindView, error) {
	sessionInfo, err := s.VerifyMiniAppSession(sessionToken)
	if err != nil {
		return MiniAppBindView{}, err
	}
	bindToken, err := s.resolveMiniAppBindToken(ctx, bindRef)
	if err != nil {
		return MiniAppBindView{}, err
	}
	displayName := strings.TrimSpace(nickname)
	if displayName == "" {
		displayName = "微信用户"
	}
	session, err := s.MarkBindSessionScanned(ctx, BindSessionScanRequest{
		BindToken: bindToken,
		OpenID:    sessionInfo.OpenID,
		UnionID:   sessionInfo.UnionID,
		Nickname:  displayName,
	})
	if err != nil {
		return MiniAppBindView{}, err
	}
	return buildMiniAppBindView(session), nil
}

// MiniAppGrantBindSession 在激励视频结束后直接发放授权。
func (s *Service) MiniAppGrantBindSession(ctx context.Context, bindRef, sessionToken string, days int) (MiniAppBindView, error) {
	sessionInfo, err := s.VerifyMiniAppSession(sessionToken)
	if err != nil {
		return MiniAppBindView{}, err
	}
	bindToken, err := s.resolveMiniAppBindToken(ctx, bindRef)
	if err != nil {
		return MiniAppBindView{}, err
	}
	session, err := s.GrantBindSession(ctx, BindSessionGrantRequest{
		BindToken: bindToken,
		Days:      days,
		OpenID:    sessionInfo.OpenID,
	})
	if err != nil {
		return MiniAppBindView{}, err
	}
	return buildMiniAppBindView(session), nil
}

// GetMiniAppCodeImage 根据绑定会话生成微信小程序码图片，供桌面端直接展示。
func (s *Service) GetMiniAppCodeImage(ctx context.Context, bindRef string) ([]byte, string, error) {
	if err := s.ensureMiniAppReady(); err != nil {
		return nil, "", err
	}
	bindToken, err := s.resolveMiniAppBindToken(ctx, bindRef)
	if err != nil {
		return nil, "", err
	}
	session, err := s.GetBindSession(ctx, bindToken)
	if err != nil {
		return nil, "", err
	}
	if session.Authorized {
		return nil, "", fmt.Errorf("bind_session_already_authorized")
	}
	if session.Status == "expired" || session.RemainingSec <= 0 {
		return nil, "", fmt.Errorf("bind_session_expired")
	}
	sceneCode := strings.TrimSpace(session.SceneCode)
	if sceneCode == "" {
		return nil, "", fmt.Errorf("bind_scene_invalid")
	}
	accessToken, err := s.fetchMiniAppAccessToken(ctx)
	if err != nil {
		return nil, "", err
	}
	return s.fetchMiniAppCodeImage(ctx, accessToken, sceneCode)
}

// GetMiniAppScanCodeImage 生成普通二维码，供“小程序内扫一扫”解析 sceneCode。
func (s *Service) GetMiniAppScanCodeImage(ctx context.Context, bindRef string) ([]byte, string, error) {
	if err := s.ensureMiniAppReady(); err != nil {
		return nil, "", err
	}
	bindToken, err := s.resolveMiniAppBindToken(ctx, bindRef)
	if err != nil {
		return nil, "", err
	}
	session, err := s.GetBindSession(ctx, bindToken)
	if err != nil {
		return nil, "", err
	}
	if session.Authorized {
		return nil, "", fmt.Errorf("bind_session_already_authorized")
	}
	if session.Status == "expired" || session.RemainingSec <= 0 {
		return nil, "", fmt.Errorf("bind_session_expired")
	}
	sceneCode := strings.TrimSpace(session.SceneCode)
	if sceneCode == "" {
		return nil, "", fmt.Errorf("bind_scene_invalid")
	}
	imageBytes, err := qrcode.Encode(sceneCode, qrcode.Medium, 360)
	if err != nil {
		return nil, "", fmt.Errorf("miniapp_scan_qrcode_failed")
	}
	return imageBytes, "image/png", nil
}

func (s *Service) ensureMiniAppReady() error {
	if err := s.ensureAdminReady(); err != nil {
		return err
	}
	if !s.cfg.MiniAppEnabled {
		return fmt.Errorf("miniapp_disabled")
	}
	if strings.TrimSpace(s.cfg.MiniAppAppID) == "" || strings.TrimSpace(s.cfg.MiniAppAppSecret) == "" {
		return fmt.Errorf("miniapp_config_incomplete")
	}
	if strings.TrimSpace(s.cfg.MiniAppSessionSecret) == "" {
		return fmt.Errorf("miniapp_session_secret_required")
	}
	return nil
}

func (s *Service) miniAppSessionTTL() time.Duration {
	if s.cfg.MiniAppSessionTTLMin <= 0 {
		return defaultMiniAppSessionTTL
	}
	return time.Duration(s.cfg.MiniAppSessionTTLMin) * time.Minute
}

func (s *Service) exchangeMiniAppCode(ctx context.Context, code string) (wechatCode2SessionResponse, error) {
	query := url.Values{}
	query.Set("appid", strings.TrimSpace(s.cfg.MiniAppAppID))
	query.Set("secret", strings.TrimSpace(s.cfg.MiniAppAppSecret))
	query.Set("js_code", strings.TrimSpace(code))
	query.Set("grant_type", "authorization_code")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.weixin.qq.com/sns/jscode2session?"+query.Encode(), nil)
	if err != nil {
		return wechatCode2SessionResponse{}, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return wechatCode2SessionResponse{}, fmt.Errorf("miniapp_wechat_request_failed")
	}
	defer func() { _ = resp.Body.Close() }()
	rawBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return wechatCode2SessionResponse{}, fmt.Errorf("miniapp_wechat_read_failed")
	}
	result := wechatCode2SessionResponse{}
	if err := json.Unmarshal(rawBody, &result); err != nil {
		return wechatCode2SessionResponse{}, fmt.Errorf("miniapp_wechat_parse_failed")
	}
	if result.ErrCode != 0 {
		return wechatCode2SessionResponse{}, fmt.Errorf("miniapp_wechat_code2session_failed")
	}
	return result, nil
}

func (s *Service) resolveMiniAppBindToken(ctx context.Context, bindRef string) (string, error) {
	ref := strings.TrimSpace(bindRef)
	if ref == "" {
		return "", fmt.Errorf("bind_ref_required")
	}
	if strings.HasPrefix(ref, "BT-") {
		return ref, nil
	}
	return s.resolveBindTokenBySceneCode(ctx, ref)
}

func (s *Service) fetchMiniAppAccessToken(ctx context.Context) (string, error) {
	s.miniAppTokenMu.Lock()
	defer s.miniAppTokenMu.Unlock()

	if token := strings.TrimSpace(s.miniAppAccessToken); token != "" && time.Now().Before(s.miniAppAccessTokenAt) {
		return token, nil
	}

	query := url.Values{}
	query.Set("grant_type", "client_credential")
	query.Set("appid", strings.TrimSpace(s.cfg.MiniAppAppID))
	query.Set("secret", strings.TrimSpace(s.cfg.MiniAppAppSecret))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.weixin.qq.com/cgi-bin/token?"+query.Encode(), nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("miniapp_wechat_access_token_failed")
	}
	defer func() { _ = resp.Body.Close() }()

	rawBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("miniapp_wechat_access_token_failed")
	}
	result := wechatAccessTokenResponse{}
	if err := json.Unmarshal(rawBody, &result); err != nil {
		return "", fmt.Errorf("miniapp_wechat_access_token_parse_failed")
	}
	if strings.TrimSpace(result.AccessToken) == "" || result.ErrCode != 0 {
		return "", fmt.Errorf("miniapp_wechat_access_token_failed")
	}

	cacheSec := result.ExpiresIn - 120
	if cacheSec < 60 {
		cacheSec = result.ExpiresIn / 2
	}
	if cacheSec < 30 {
		cacheSec = 30
	}
	s.miniAppAccessToken = strings.TrimSpace(result.AccessToken)
	s.miniAppAccessTokenAt = time.Now().Add(time.Duration(cacheSec) * time.Second)
	return s.miniAppAccessToken, nil
}

func (s *Service) fetchMiniAppCodeImage(ctx context.Context, accessToken, sceneCode string) ([]byte, string, error) {
	payload := map[string]any{
		"scene":       strings.TrimSpace(sceneCode),
		"page":        miniAppFirstNonEmpty(strings.TrimSpace(s.cfg.MiniAppPagePath), "pages/index/index"),
		"env_version": miniAppFirstNonEmpty(strings.TrimSpace(s.cfg.MiniAppEnvVersion), "release"),
		"check_path":  false,
		"width":       280,
		"is_hyaline":  true,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token="+url.QueryEscape(strings.TrimSpace(accessToken)), bytes.NewReader(body))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("miniapp_wechat_code_image_failed")
	}
	defer func() { _ = resp.Body.Close() }()

	rawBody, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, "", fmt.Errorf("miniapp_wechat_code_image_failed")
	}
	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if strings.Contains(strings.ToLower(contentType), "application/json") || (len(rawBody) > 0 && rawBody[0] == '{') {
		result := wechatMiniAppCodeError{}
		if err := json.Unmarshal(rawBody, &result); err == nil && result.ErrCode != 0 {
			return nil, "", fmt.Errorf("miniapp_wechat_code_image_failed")
		}
		return nil, "", fmt.Errorf("miniapp_wechat_code_image_failed")
	}
	if contentType == "" {
		contentType = "image/png"
	}
	return rawBody, contentType, nil
}

func (s *Service) signMiniAppSession(claims miniAppSessionClaims) (string, error) {
	raw, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(s.cfg.MiniAppSessionSecret)))
	_, _ = mac.Write([]byte(payload))
	signature := hex.EncodeToString(mac.Sum(nil))
	return payload + "." + signature, nil
}

func (s *Service) parseMiniAppSession(sessionToken string) (miniAppSessionClaims, error) {
	token := strings.TrimSpace(sessionToken)
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return miniAppSessionClaims{}, fmt.Errorf("miniapp_session_invalid")
	}
	payload := parts[0]
	signature := parts[1]
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(s.cfg.MiniAppSessionSecret)))
	_, _ = mac.Write([]byte(payload))
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(signature), []byte(expected)) {
		return miniAppSessionClaims{}, fmt.Errorf("miniapp_session_invalid")
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return miniAppSessionClaims{}, fmt.Errorf("miniapp_session_invalid")
	}
	claims := miniAppSessionClaims{}
	if err := json.Unmarshal(raw, &claims); err != nil {
		return miniAppSessionClaims{}, fmt.Errorf("miniapp_session_invalid")
	}
	if strings.TrimSpace(claims.OpenID) == "" {
		return miniAppSessionClaims{}, fmt.Errorf("miniapp_session_invalid")
	}
	return claims, nil
}

func buildMiniAppBindView(session BindSession) MiniAppBindView {
	view := MiniAppBindView{
		BindToken:      strings.TrimSpace(session.BindToken),
		SceneCode:      strings.TrimSpace(session.SceneCode),
		Status:         strings.TrimSpace(session.Status),
		Message:        strings.TrimSpace(session.Message),
		ClientLabel:    maskMiniAppClientLabel(session.ClientID),
		AppVersion:     strings.TrimSpace(session.AppVersion),
		WechatNickname: strings.TrimSpace(session.WechatNickname),
		Authorized:     session.Authorized,
		AdUnlockDays:   session.AdUnlockDays,
		ExpireAtMS:     session.ExpireAtMS,
		RemainingSec:   session.RemainingSec,
		ScannedAtMS:    session.ScannedAtMS,
		GrantedAtMS:    session.GrantedAtMS,
	}
	if session.License != nil {
		view.LicenseExpireAtMS = session.License.ExpireAtMS
	}
	return view
}

func maskMiniAppClientLabel(clientID string) string {
	raw := strings.TrimSpace(clientID)
	if raw == "" {
		return ""
	}
	if len(raw) <= 10 {
		return raw
	}
	return raw[:4] + "..." + raw[len(raw)-4:]
}

func miniAppFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
