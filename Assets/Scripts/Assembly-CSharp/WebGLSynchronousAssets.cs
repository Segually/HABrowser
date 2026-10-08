#if UNITY_WEBGL && !UNITY_EDITOR
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;

// Existing game code reads these assets synchronously. WebGL must finish their
// asynchronous loads before opening the menu, and retain the handles afterwards.
public static class WebGLSynchronousAssets
{
    private static readonly Dictionary<string, AsyncOperationHandle> assets =
        new Dictionary<string, AsyncOperationHandle>(StringComparer.Ordinal);

    public static bool IsReady { get; private set; }

    public static IEnumerator Preload()
    {
        if (IsReady)
            yield break;

        var initialization = Addressables.InitializeAsync(false);
        yield return initialization;
        if (initialization.Status != AsyncOperationStatus.Succeeded)
        {
            Debug.LogError("Unable to initialize WebGL game assets: " + initialization.OperationException);
            Addressables.Release(initialization);
            yield break;
        }

        var keys = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var locator in Addressables.ResourceLocators)
        {
            foreach (var key in locator.Keys)
            {
                var path = key as string;
                if (path != null && GetAssetType(path) != null)
                    keys.Add(path);
            }
        }
        Addressables.Release(initialization);

        if (keys.Count == 0)
        {
            Debug.LogError("The WebGL Addressables catalog contains no SYNCHRONOUS assets. Rebuild Addressables for WebGL.");
            yield break;
        }

        var pending = new List<AsyncOperationHandle>();
        foreach (var path in keys)
        {
            AsyncOperationHandle handle;
            var type = GetAssetType(path);
            if (type == typeof(TextAsset))
                handle = Addressables.LoadAssetAsync<TextAsset>(path);
            else if (type == typeof(Texture2D))
                handle = Addressables.LoadAssetAsync<Texture2D>(path);
            else
                handle = Addressables.LoadAssetAsync<GameObject>(path);
            assets.Add(path, handle);
            pending.Add(handle);

            // Keep the browser responsive and limit concurrent load operations.
            if (pending.Count == 32)
            {
                foreach (var operation in pending)
                    yield return operation;
                pending.Clear();
            }
        }
        foreach (var operation in pending)
            yield return operation;

        foreach (var entry in assets)
        {
            if (entry.Value.Status != AsyncOperationStatus.Succeeded)
            {
                Debug.LogError("Unable to preload " + entry.Key + ": " + entry.Value.OperationException);
                foreach (var handle in assets.Values)
                    Addressables.Release(handle);
                assets.Clear();
                yield break;
            }
        }
        IsReady = true;
        Debug.Log("WebGL synchronous assets ready: " + assets.Count);
    }

    public static T Get<T>(string path) where T : UnityEngine.Object
    {
        AsyncOperationHandle handle;
        if (assets.TryGetValue(path.Replace('\\', '/'), out handle))
            return handle.Result as T;
        return null;
    }

    private static Type GetAssetType(string path)
    {
        if ((path.StartsWith("Assets/SYNCHRONOUS/TextFiles/", StringComparison.Ordinal) && path.EndsWith(".txt", StringComparison.OrdinalIgnoreCase)) ||
            (path.StartsWith("Assets/SYNCHRONOUS/BytesFiles/", StringComparison.Ordinal) && path.EndsWith(".bytes", StringComparison.OrdinalIgnoreCase)))
            return typeof(TextAsset);
        if (path.StartsWith("Assets/SYNCHRONOUS/Images/", StringComparison.Ordinal) && path.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            return typeof(Texture2D);
        if (path.StartsWith("Assets/SYNCHRONOUS/Windows/", StringComparison.Ordinal) && path.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
            return typeof(GameObject);
        return null;
    }
}
#endif
