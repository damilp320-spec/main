// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "HLAmbienceManager.generated.h"

class UHLAmbientEmitterComponent;

/**
 * World subsystem that owns the soundscape. Every UHLAmbientEmitterComponent
 * registers here on BeginPlay; the TensionDirector pushes a global intensity that
 * this manager fans out to all emitters, so the whole block breathes together —
 * louder/busier when calm, sparser and wronger as tension climbs.
 */
UCLASS()
class HOLLOWBLOCK_API UHLAmbienceManager : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	/** Convenience accessor from any WorldContext object. */
	static UHLAmbienceManager* Get(const UObject* WorldContext);

	void RegisterEmitter(UHLAmbientEmitterComponent* Emitter);
	void UnregisterEmitter(UHLAmbientEmitterComponent* Emitter);

	/** Sets the global ambience intensity (0..1) and applies it to all emitters. */
	UFUNCTION(BlueprintCallable, Category = "Ambience")
	void SetGlobalIntensity(float InIntensity);

	UFUNCTION(BlueprintPure, Category = "Ambience")
	float GetGlobalIntensity() const { return GlobalIntensity; }

private:
	UPROPERTY(Transient)
	TArray<TWeakObjectPtr<UHLAmbientEmitterComponent>> Emitters;

	float GlobalIntensity = 1.f;
};
