import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("expo-background-task and expo-task-manager contain crash fixes for background execution", () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(currentDir, "..");

  const appDelegatePath = path.join(
    rootDir,
    "node_modules",
    "expo-background-task",
    "ios",
    "BackgroundTaskAppDelegate.swift"
  );
  assert.ok(fs.existsSync(appDelegatePath), "BackgroundTaskAppDelegate.swift must exist");
  const appDelegateContent = fs.readFileSync(appDelegatePath, "utf8");
  assert.ok(
    appDelegateContent.includes("DispatchQueue.main.async"),
    "BackgroundTaskAppDelegate must dispatch runTasks on main thread to avoid thread collisions"
  );

  const requestPath = path.join(
    rootDir,
    "node_modules",
    "expo-task-manager",
    "ios",
    "EXTaskManager",
    "EXTaskExecutionRequest.m"
  );
  assert.ok(fs.existsSync(requestPath), "EXTaskExecutionRequest.m must exist");
  const requestContent = fs.readFileSync(requestPath, "utf8");
  assert.ok(
    requestContent.includes("@synchronized(self)"),
    "EXTaskExecutionRequest must synchronize task list mutation and callback evaluation"
  );

  const servicePath = path.join(
    rootDir,
    "node_modules",
    "expo-task-manager",
    "ios",
    "EXTaskManager",
    "EXTaskService.m"
  );
  assert.ok(fs.existsSync(servicePath), "EXTaskService.m must exist");
  const serviceContent = fs.readFileSync(servicePath, "utf8");
  assert.ok(
    serviceContent.includes("if (!tasksAdded)"),
    "EXTaskService must only evaluate immediately when no tasks were added"
  );
  assert.ok(
    serviceContent.includes("@synchronized(_requests)"),
    "EXTaskService must synchronize access to the requests collection"
  );
});
