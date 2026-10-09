#if UNITY_WEBGL && !UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.Scripting;
using UnityEngine.UI;

// Unity 2021 does not create native browser inputs for its canvas text fields.
// The JavaScript touch handler calls back synchronously so focus stays inside
// the browser's user gesture (required to open the keyboard on iOS).
[Preserve]
public sealed class WebGLTextInput : MonoBehaviour
{
    private static WebGLTextInput instance;
    private readonly List<RaycastResult> hits = new List<RaycastResult>();
    private InputField legacy;
    private TMP_InputField tmp;
    private Action<string> completed;
    private string original;
    private bool editing;
    private bool previousCapture;

    [DllImport("__Internal")] private static extern void HA_TextInputInit(string receiver);
    [DllImport("__Internal")] private static extern void HA_TextInputOpen(string value, string label, int limit, int multiline, int secure, int numeric);
    [DllImport("__Internal")] private static extern void HA_TextInputValue(string value);
    [DllImport("__Internal")] private static extern void HA_TextInputClose();

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void Initialize()
    {
        if (instance != null) return;
        var host = new GameObject("BrowserTextInput");
        DontDestroyOnLoad(host);
        instance = host.AddComponent<WebGLTextInput>();
        HA_TextInputInit(host.name);
    }

    public static void Open(string value, string label, Action<string> onDone)
    {
        instance.Close(false);
        instance.completed = onDone;
        instance.Begin(value, label, 0, false, false, false);
    }

    [Preserve] public void OnBrowserTap(string position)
    {
        if (editing || EventSystem.current == null) return;
        var parts = position.Split(',');
        if (parts.Length != 2) return;
        float x, y;
        if (!float.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out x) ||
            !float.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out y)) return;
        var pointer = new PointerEventData(EventSystem.current) { position = new Vector2(x * Screen.width, y * Screen.height) };
        hits.Clear();
        EventSystem.current.RaycastAll(pointer, hits);
        if (hits.Count == 0) return;
        // Respect the frontmost UI graphic, including modal windows over fields.
        var target = hits[0].gameObject;
        var field = target.GetComponentInParent<InputField>();
        var tmpField = target.GetComponentInParent<TMP_InputField>();
        if (field != null && field.IsActive() && field.IsInteractable() && !field.readOnly)
        {
            legacy = field;
            var endEdit = field.onEndEdit;
            field.onEndEdit = new InputField.EndEditEvent();
            field.DeactivateInputField();
            field.enabled = false;
            field.onEndEdit = endEdit;
            Begin(field.text, Label(field.placeholder, field.gameObject.name), field.characterLimit,
                field.lineType != InputField.LineType.SingleLine,
                field.inputType == InputField.InputType.Password,
                field.contentType == InputField.ContentType.IntegerNumber || field.contentType == InputField.ContentType.DecimalNumber);
        }
        else if (tmpField != null && tmpField.IsActive() && tmpField.IsInteractable() && !tmpField.readOnly)
        {
            tmp = tmpField;
            var endEdit = tmpField.onEndEdit;
            tmpField.onEndEdit = new TMP_InputField.SubmitEvent();
            tmpField.DeactivateInputField();
            tmpField.enabled = false;
            tmpField.onEndEdit = endEdit;
            Begin(tmpField.text, Label(tmpField.placeholder, tmpField.gameObject.name), tmpField.characterLimit,
                tmpField.lineType != TMP_InputField.LineType.SingleLine,
                tmpField.inputType == TMP_InputField.InputType.Password,
                tmpField.contentType == TMP_InputField.ContentType.IntegerNumber || tmpField.contentType == TMP_InputField.ContentType.DecimalNumber);
        }
    }

    private static string Label(Graphic placeholder, string fallback)
    {
        var text = placeholder as Text;
        if (text != null && !string.IsNullOrEmpty(text.text)) return text.text;
        var tmpText = placeholder as TMP_Text;
        return tmpText != null && !string.IsNullOrEmpty(tmpText.text) ? tmpText.text : fallback;
    }

    private void Begin(string value, string label, int limit, bool multiline, bool secure, bool numeric)
    {
        original = value;
        editing = true;
        previousCapture = WebGLInput.captureAllKeyboardInput;
        WebGLInput.captureAllKeyboardInput = false;
        if (EventSystem.current != null) EventSystem.current.SetSelectedGameObject(null);
        HA_TextInputOpen(value, label, limit, multiline ? 1 : 0, secure ? 1 : 0, numeric ? 1 : 0);
    }

    [Preserve] public void OnBrowserText(string value)
    {
        if (!editing) return;
        if (legacy != null) { legacy.text = value; HA_TextInputValue(legacy.text); }
        else if (tmp != null) { tmp.text = value; HA_TextInputValue(tmp.text); }
    }

    [Preserve] public void OnBrowserDone(string value)
    {
        if (!editing) return;
        OnBrowserText(value);
        var field = legacy;
        var tmpField = tmp;
        var callback = completed;
        var text = field != null ? field.text : tmpField != null ? tmpField.text : value;
        Close(false);
        if (field != null && field.IsActive()) field.onEndEdit.Invoke(text);
        else if (tmpField != null && tmpField.IsActive()) tmpField.onEndEdit.Invoke(text);
        else if (callback != null) callback(text);
    }

    [Preserve] public void OnBrowserCancel(string unused) { Close(true); }

    private void Close(bool restore)
    {
        if (!editing) return;
        if (restore) OnBrowserText(original);
        editing = false;
        HA_TextInputClose();
        WebGLInput.captureAllKeyboardInput = previousCapture;
        if (legacy != null) legacy.enabled = true;
        if (tmp != null) tmp.enabled = true;
        legacy = null;
        tmp = null;
        completed = null;
    }

    private void Update()
    {
        if (editing && completed == null &&
            (legacy == null || !legacy.gameObject.activeInHierarchy || !legacy.IsInteractable()) &&
            (tmp == null || !tmp.gameObject.activeInHierarchy || !tmp.IsInteractable())) Close(false);
    }
}
#endif
