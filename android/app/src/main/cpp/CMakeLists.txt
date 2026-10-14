cmake_minimum_required(VERSION 3.22.1)
project(nativefluidsynth)

find_package(fluidsynth-android REQUIRED CONFIG)

add_library(nativefluidsynth SHARED nativefluidsynth.cpp)
target_link_libraries(nativefluidsynth fluidsynth-android::fluidsynth log)
